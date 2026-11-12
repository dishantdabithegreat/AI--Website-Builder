import { createOpenAI } from "@ai-sdk/openai";
import { generateObject } from "ai";
import pMap from "p-map";
import { FileCodeSchema, FilePlanSchema, RevisionResultSchema } from "./aiSchemas.js";
import { buildFileCodeSystem, FILE_PLAN_SYSTEM, REVISE_SYSTEM } from "./prompts.js";
import { normalizeContent } from "./contentNormalizer.js";
import { validateAndFixCode, validateRevisionContent } from "./codeValidator.js";
import { parse } from "@babel/parser";

// --- OpenRouter Model Client Setup ---
const MODEL = process.env.OPENROUTER_MODEL || "openrouter/free";
const MAX_CONCURRENCY = parseInt(process.env.AI_MAX_CONCURRENCY || "2", 10);

const openrouter = createOpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENROUTER_API_KEY,
});

const model = openrouter.chat(MODEL);

// Generate a single file, then ask the model to repair it once if JSX/JS parsing fails.
async function generateSingleFile(file, allFiles, prompt, alreadyGeneratedFiles) {
    const system = buildFileCodeSystem(allFiles, alreadyGeneratedFiles);
    const userMsg = `Project: ${prompt}\n\nWrite the complete code for: ${file.path}\nPurpose: ${file.description}`;

    console.log(`[AI] Creating file: ${file.path}...`);

    const generateCode = async (repairContext = "") => {
        const { object } = await generateObject({
            model,
            schema: FileCodeSchema,
            system: repairContext
                ? `${system}\n\n${repairContext}`
                : system,
            prompt: repairContext ? repairContext : userMsg,
            maxRetries: 2,
        });

        return normalizeContent(object.code);
    };

    let code = await generateCode();

    if (code.trim().length === 0) {
        throw new Error(`Generated code for ${file.path} is empty after normalization`);
    }

    // Existing safe auto-fixes + real Babel syntax validation.
    try {
        const validation = validateAndFixCode(code, file.path, {
            allPlannedFiles: allFiles,
        });

        code = validation.code;

        if (validation.warnings.length > 0) {
            console.log(
                `[Validator] Code adjustments for ${file.path}:\n  - ${validation.warnings.join("\n  - ")}`
            );
        }
    } catch (error) {
        // Only send syntax errors back for repair. Other errors should retain their
        // original behavior and be handled by the existing file retry mechanism.
        if (!(error instanceof SyntaxError)) {
            throw error;
        }

        console.warn(`[Validator] Syntax error in ${file.path}; requesting one AI repair: ${error.message}`);

        const repairPrompt = `The code you generated for ${file.path} has a JavaScript/JSX syntax error.

Exact parser error:
${error.message}

Return the COMPLETE corrected contents of ${file.path}, not a diff.
Do not omit sections or use placeholders.
Preserve the intended UI, behavior, imports, and component structure.
Pay special attention to JSX event handlers: use valid arrow syntax such as onChange={(e) => setValue(e.target.value)}.
Return code only in the schema's code field.

Original generated code:
\`\`\`jsx
${code}
\`\`\``;

        code = await generateCode(repairPrompt);

        if (code.trim().length === 0) {
            throw new Error(`AI returned empty repaired code for ${file.path}`);
        }

        // The repaired result must pass the same validator; otherwise fail this
        // file and let the existing retry rounds handle it.
        const repairedValidation = validateAndFixCode(code, file.path, {
            allPlannedFiles: allFiles,
        });

        code = repairedValidation.code;

        if (repairedValidation.warnings.length > 0) {
            console.log(
                `[Validator] Repair adjustments for ${file.path}:\n  - ${repairedValidation.warnings.join("\n  - ")}`
            );
        }
    }

    console.log(`[AI] Created file: ${file.path} (${code.length} chars)`);
    return { path: file.path, code };
}


// Normalize paths such as /components/../Header.js
function normalizeProjectPath(filePath) {
    const parts = [];

    for (const part of filePath.split("/")) {
        if (!part || part === ".") continue;

        if (part === "..") {
            parts.pop();
        } else {
            parts.push(part);
        }
    }

    return "/" + parts.join("/");
}

// Find local imports in generated JavaScript/JSX files.

function getLocalImports(code) {
    const ast = parse(code, {
        sourceType: "unambiguous",
        plugins: ["jsx"],
    });

    const imports = [];

    function walk(node) {
        if (!node || typeof node !== "object") return;

        if (
            node.type === "ImportDeclaration" ||
            node.type === "ExportNamedDeclaration" ||
            node.type === "ExportAllDeclaration"
        ) {
            if (node.source?.value) {
                imports.push(node.source.value);
            }
        }

        // Detect require("./file")
        if (
            node.type === "CallExpression" &&
            node.callee?.type === "Identifier" &&
            node.callee.name === "require" &&
            node.arguments?.[0]?.type === "StringLiteral"
        ) {
            imports.push(node.arguments[0].value);
        }

        // Detect dynamic imports: import("./Component")
        if (
            node.type === "ImportExpression" &&
            node.source?.type === "StringLiteral"
        ) {
            imports.push(node.source.value);
        }

        // Compatibility with Babel AST versions using CallExpression
        if (
            node.type === "CallExpression" &&
            node.callee?.type === "Import" &&
            node.arguments?.[0]?.type === "StringLiteral"
        ) {
            imports.push(node.arguments[0].value);
        }

        for (const value of Object.values(node)) {
            if (Array.isArray(value)) {
                value.forEach(walk);
            } else if (value && typeof value === "object") {
                walk(value);
            }
        }
    }

    ast.program.body.forEach(walk);

    return [...new Set(imports)];
}


// Check whether a relative import resolves to an existing generated file.
function findMissingLocalImports(files) {
    const existingFiles = new Set(
        Object.keys(files).map(normalizeProjectPath)
    );

    const missing = [];

    for (const [filePath, code] of Object.entries(files)) {
        if (!/\.(js|jsx)$/.test(filePath)) continue;

        const imports = getLocalImports(code);

        for (const specifier of imports) {
            if (!specifier.startsWith(".")) continue;
            // Ignore static assets and media files.
            if (
                /\.(svg|png|jpe?g|webp|gif|ico|avif|mp4|webm|mp3|wav|woff2?|ttf|otf|eot)(\?.*)?$/i.test(specifier)
            ) {
                continue;
            }

            const currentPath = normalizeProjectPath(filePath);
            const directory = currentPath.slice(
                0,
                currentPath.lastIndexOf("/")
            );

            const target = normalizeProjectPath(
                `${directory}/${specifier}`
            );

            const hasExtension = /\.(js|jsx|ts|tsx|css|json)$/.test(target);

            const candidates = hasExtension
                ? [target]
                : [
                    `${target}.js`,
                    `${target}.jsx`,
                    `${target}.ts`,
                    `${target}.tsx`,
                    `${target}.css`,
                    `${target}/index.js`,
                    `${target}/index.jsx`,
                ];

            const exists = candidates.some((candidate) =>
                existingFiles.has(candidate)
            );

            if (!exists) {
                const suggestedPath = hasExtension
                    ? target
                    : `${target}.js`;

                missing.push({
                    path: suggestedPath,
                    importer: filePath,
                    specifier,
                });
            }
        }
    }

    // Avoid generating the same missing component more than once.
    return [
        ...new Map(
            missing.map((item) => [item.path, item])
        ).values(),
    ];
}


// Generate project files: plan first, then build files in order with fallback retries.
export async function generateProject(prompt, callbacks) {
    // Phase 1: Plan
    console.log(`[AI] Phase 1: Planning file structure for: "${prompt.slice(0, 80)}..."`);

    const { object: plan } = await generateObject({
        model,
        schema: FilePlanSchema,
        system: FILE_PLAN_SYSTEM,
        prompt: `Plan a React website for: ${prompt}`,
        maxRetries: 2,
    });

    if (!plan.files.find((f) => f.path === "/App.js")) {
        plan.files.unshift({
            path: "/App.js",
            description: "Main application entry point",
            exports: "default App",
            imports: ["./styles.css"],
        });
    }

    if (!plan.files.find((f) => f.path === "/styles.css")) {
        plan.files.push({
            path: "/styles.css",
            description: "Global CSS: Google Font import, keyframe animations, utility classes",
            exports: "none",
            imports: [],
        });
    }

    if (callbacks?.onPlan) {
        await callbacks.onPlan(plan);
    }

    console.log(
        `[AI] Phase 2: Generating ${plan.files.length} files in parallel (concurrency=${MAX_CONCURRENCY}): ${plan.files.map((f) => f.path).join(", ")}`
    );

    const files = {};
    let pendingFiles = plan.files.map((f) => ({ ...f }));
    const maxRetryRounds = 2;

    for (let round = 0; round <= maxRetryRounds; round++) {
        if (pendingFiles.length === 0) break;

        if (round > 0) {
            console.log(
                `[AI] Retry round ${round}/${maxRetryRounds} for ${pendingFiles.length} failed files: ${pendingFiles.map((f) => f.path).join(", ")}`
            );
        }

        const results = await pMap(
            pendingFiles,
            async (file) => {
                try {
                    if (callbacks?.onFileStart) {
                        await callbacks.onFileStart(file.path);
                    }

                    const singleResult = await generateSingleFile(
                        file,
                        plan.files,
                        prompt,
                        files
                    );

                    if (callbacks?.onFileComplete) {
                        await callbacks.onFileComplete(file.path, singleResult.code);
                    }

                    return { success: true, file, result: singleResult };
                } catch (err) {
                    return { success: false, file, error: err };
                }
            },
            { concurrency: MAX_CONCURRENCY }
        );

        const failedFiles = [];

        for (const entry of results) {
            if (entry.success) {
                const { path, code } = entry.result;
                files[path.startsWith("/") ? path : `/${path}`] = code;
            } else {
                console.warn(
                    `[AI] File ${entry.file.path} failed in round ${round}: ${entry.error?.message || entry.error}`
                );
                failedFiles.push(entry.file);
            }
        }

        pendingFiles = failedFiles;
    }

    if (pendingFiles.length > 0) {
        const failedPaths = pendingFiles.map((f) => f.path).join(", ");
        console.error(
            `[AI] Failed to generate ${pendingFiles.length} files after all retry rounds: ${failedPaths}`
        );

        // Keep the preview bootable if an individual file exhausts its retries.
        if (pendingFiles.length > 0) {
            const failedPaths = pendingFiles.map((f) => f.path).join(", ");

            console.error(
                `[AI] Failed to generate ${pendingFiles.length} files after all retry rounds: ${failedPaths}`
            );
        }
    }


    // Phase 3: Project Integrity Check & Missing File Recovery
    console.log("[Integrity] Checking generated project imports...");

    const maxMissingFileRounds = 3;
    const attemptedMissingFiles = new Set();

    for (let round = 1; round <= maxMissingFileRounds; round++) {
        const missingFiles = findMissingLocalImports(files).filter(
            (item) =>
                !files[item.path] &&
                !attemptedMissingFiles.has(item.path)
        );

        if (missingFiles.length === 0) {
            break;
        }

        console.warn(
            `[Integrity] Found ${missingFiles.length} missing imports:`,
            missingFiles.map((item) => item.path)
        );

        const descriptors = missingFiles.map((item) => {
            attemptedMissingFiles.add(item.path);

            // Reuse the original planned file if it already exists.
            const existingDescriptor = plan.files.find(
                (file) => normalizeProjectPath(file.path) === item.path
            );

            if (existingDescriptor) {
                return existingDescriptor;
            }

            const isCSS = item.path.endsWith(".css");
            const name = item.path.split("/").pop().replace(/\.[^.]+$/, "");

            const descriptor = {
                path: item.path,
                description: isCSS
                    ? `Stylesheet imported by ${item.importer}`
                    : `Missing React component ${name}, imported by ${item.importer}. Generate a complete, functional component matching the existing project design.`,
                exports: isCSS ? "none" : "default",
                imports: [],
            };

            plan.files.push(descriptor);

            return descriptor;
        });

        const recoveryResults = await pMap(
            descriptors,
            async (file) => {
                try {
                    console.log(`[Integrity] Generating missing file: ${file.path}`);

                    if (callbacks?.onFileStart) {
                        await callbacks.onFileStart(file.path);
                    }

                    const result = await generateSingleFile(
                        file,
                        plan.files,
                        prompt,
                        files
                    );

                    if (callbacks?.onFileComplete) {
                        await callbacks.onFileComplete(
                            file.path,
                            result.code
                        );
                    }

                    return { success: true, result };
                } catch (error) {
                    console.error(
                        `[Integrity] Could not recover ${file.path}:`,
                        error.message
                    );

                    return { success: false, file, error };
                }
            },
            { concurrency: MAX_CONCURRENCY }
        );

        for (const entry of recoveryResults) {
            if (!entry.success) {
                throw new Error(
                    `Could not generate required file ${entry.file.path}: ${entry.error.message}`
                );
            }

            files[entry.result.path] = entry.result.code;
        }
    }

    // Final integrity check
    const unresolvedImports = findMissingLocalImports(files);

    if (unresolvedImports.length > 0) {
        throw new Error(
            "Project has unresolved imports: " +
            unresolvedImports.map(
                (item) => `${item.importer} -> ${item.specifier}`
            ).join(", ")
        );
    }

    console.log("[Integrity] All local imports resolved successfully.");

    if (!files["/App.js"]) {
        throw new Error("AI did not generate /App.js entry point");
    }


    return { files, description: plan.projectDescription };
}

export async function reviseProject(prompt, manifest, relevantFiles, recentMessages) {
    const contextParts = [];

    contextParts.push("## Current Project Files (manifest)");
    contextParts.push("```");
    for (const f of manifest) {
        contextParts.push(`${f.path} (${f.hash}, ${f.size}B)`);
    }
    contextParts.push("```");

    if (Object.keys(relevantFiles).length > 0) {
        contextParts.push("\n## File Contents (for reference)");
        for (const [path, content] of Object.entries(relevantFiles)) {
            contextParts.push(`\n### ${path}\n\`\`\`\n${content}\n\`\`\``);
        }
    }

    if (recentMessages.length > 0) {
        contextParts.push("\n## Recent Conversation");
        for (const msg of recentMessages.slice(-3)) {
            contextParts.push(`${msg.role}: ${msg.content}`);
        }
    }

    contextParts.push(`\n## Revision Request\n${prompt}`);

    console.log("[AI] Revising project...");

    const { object: rawParsed } = await generateObject({
        model,
        schema: RevisionResultSchema,
        system: REVISE_SYSTEM,
        prompt: contextParts.join("\n"),
        maxRetries: 2,
    });

    if (rawParsed && Array.isArray(rawParsed.operations)) {
        rawParsed.operations = rawParsed.operations.map((op) => {
            if (!op || typeof op !== "object") return op;

            const opStr = String(op.op || "").trim().toLowerCase();

            if (["create", "add", "new"].includes(opStr)) op.op = "create";
            else if (["update", "edit", "modify", "patch"].includes(opStr)) op.op = "update";
            else if (["delete", "remove", "del", "rm"].includes(opStr)) op.op = "delete";

            if (op.path && typeof op.path === "string" && !op.path.startsWith("/")) {
                op.path = `/${op.path}`;
            }

            if (op.content) op.content = normalizeContent(op.content);
            if (op.search) op.search = normalizeContent(op.search);
            if (op.replace) op.replace = normalizeContent(op.replace);

            if (op.op === "create" && op.content) {
                const validation = validateRevisionContent(op.content, op.path, "create");
                op.content = validation.content;

                if (validation.warnings.length > 0) {
                    console.log(
                        `[Validator] Revision Create adjustments for ${op.path}:\n  - ${validation.warnings.join("\n  - ")}`
                    );
                }
            } else if (op.op === "update" && op.replace) {
                const validation = validateRevisionContent(op.replace, op.path, "update");
                op.replace = validation.content;

                if (validation.warnings.length > 0) {
                    console.log(
                        `[Validator] Revision Update adjustments for ${op.path}:\n  - ${validation.warnings.join("\n  - ")}`
                    );
                }
            }

            return op;
        });
    }

    return rawParsed;
}
