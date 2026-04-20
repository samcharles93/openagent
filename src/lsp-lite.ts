import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import ts from "typescript";

const SUPPORTED_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".cts",
  ".mjs",
  ".cjs",
]);

export type LspPosition = {
  line: number;
  character: number;
};

export type LspDiagnosticResult = {
  filePath: string;
  configPath: string | null;
  diagnostics: Array<{
    filePath: string;
    category: string;
    code: string;
    message: string;
    start: LspPosition;
  }>;
};

export type LspDefinitionResult = {
  filePath: string;
  configPath: string | null;
  symbolName: string;
  definitions: Array<{
    filePath: string;
    start: LspPosition;
    end: LspPosition;
    context: string;
  }>;
};

export type LspReferenceResult = {
  filePath: string;
  configPath: string | null;
  symbolName: string;
  references: Array<{
    filePath: string;
    start: LspPosition;
    context: string;
    isDefinition: boolean;
  }>;
};

export type LspRenameResult = {
  filePath: string;
  configPath: string | null;
  symbolName: string;
  canRename: boolean;
  fileEdits: Array<{
    filePath: string;
    edits: Array<{
      start: LspPosition;
      end: LspPosition;
      originalText: string;
      newText: string;
    }>;
  }>;
  applied: boolean;
};

type TsProjectContext = {
  absoluteFilePath: string;
  configPath: string | null;
  service: ts.LanguageService;
};

function normalizePath(filePath: string): string {
  return path.resolve(filePath);
}

function isPathInsideRoot(root: string, targetPath: string): boolean {
  const relative = path.relative(root, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function ensureSupportedFile(filePath: string): string {
  const absolute = normalizePath(filePath);
  if (!existsSync(absolute)) {
    throw new Error(`LSP-lite target "${filePath}" does not exist.`);
  }

  if (!SUPPORTED_EXTENSIONS.has(path.extname(absolute))) {
    throw new Error(
      `LSP-lite only supports TypeScript and JavaScript files. Unsupported target: ${filePath}`,
    );
  }

  return absolute;
}

function resolveTargetPath(cwd: string, rawPath: string): string {
  return ensureSupportedFile(path.isAbsolute(rawPath) ? rawPath : path.resolve(cwd, rawPath));
}

function resolveProjectFiles(cwd: string, targetFile: string): {
  configPath: string | null;
  fileNames: string[];
  options: ts.CompilerOptions;
} {
  const configPath = ts.findConfigFile(path.dirname(targetFile), ts.sys.fileExists);
  if (configPath) {
    const readResult = ts.readConfigFile(configPath, ts.sys.readFile);
    if (readResult.error) {
      throw new Error(ts.flattenDiagnosticMessageText(readResult.error.messageText, "\n"));
    }

    const parsed = ts.parseJsonConfigFileContent(
      readResult.config,
      ts.sys,
      path.dirname(configPath),
      undefined,
      configPath,
    );
    if (parsed.errors.length > 0) {
      throw new Error(
        parsed.errors.map((error) => ts.flattenDiagnosticMessageText(error.messageText, "\n")).join("\n"),
      );
    }

    const fileNames = new Set(parsed.fileNames.map(normalizePath));
    fileNames.add(targetFile);
    return {
      configPath,
      fileNames: [...fileNames],
      options: parsed.options,
    };
  }

  const discovered = ts.sys.readDirectory(cwd, [...SUPPORTED_EXTENSIONS], undefined, undefined);
  const fileNames = new Set(discovered.map(normalizePath));
  fileNames.add(targetFile);
  return {
    configPath: null,
    fileNames: [...fileNames],
    options: {
      allowJs: true,
      checkJs: true,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      skipLibCheck: true,
    },
  };
}

function createProjectContext(cwd: string, rawPath: string): TsProjectContext {
  const absoluteFilePath = resolveTargetPath(cwd, rawPath);
  const project = resolveProjectFiles(cwd, absoluteFilePath);
  const snapshots = new Map<string, ts.IScriptSnapshot>();

  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => project.options,
    getScriptFileNames: () => project.fileNames,
    getScriptVersion: () => "1",
    getScriptSnapshot: (fileName) => {
      const absolute = normalizePath(fileName);
      if (!existsSync(absolute)) {
        return undefined;
      }
      const cached = snapshots.get(absolute);
      if (cached) {
        return cached;
      }
      const content = ts.sys.readFile(absolute);
      if (typeof content !== "string") {
        return undefined;
      }
      const snapshot = ts.ScriptSnapshot.fromString(content);
      snapshots.set(absolute, snapshot);
      return snapshot;
    },
    getCurrentDirectory: () => cwd,
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
    useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
    getNewLine: () => ts.sys.newLine,
  };

  return {
    absoluteFilePath,
    configPath: project.configPath,
    service: ts.createLanguageService(host, ts.createDocumentRegistry()),
  };
}

function getSourceFileOrThrow(service: ts.LanguageService, filePath: string): ts.SourceFile {
  const sourceFile = service.getProgram()?.getSourceFile(filePath);
  if (!sourceFile) {
    throw new Error(`LSP-lite could not load source file "${filePath}".`);
  }
  return sourceFile;
}

function toOffset(sourceFile: ts.SourceFile, position: LspPosition): number {
  const line = Math.max(position.line - 1, 0);
  const character = Math.max(position.character - 1, 0);
  if (line >= sourceFile.getLineStarts().length) {
    throw new Error(`Line ${position.line} is outside ${sourceFile.fileName}.`);
  }
  return ts.getPositionOfLineAndCharacter(sourceFile, line, character);
}

function fromOffset(sourceFile: ts.SourceFile, offset: number): LspPosition {
  const { line, character } = ts.getLineAndCharacterOfPosition(sourceFile, offset);
  return {
    line: line + 1,
    character: character + 1,
  };
}

function diagnosticCategoryName(category: ts.DiagnosticCategory): string {
  switch (category) {
    case ts.DiagnosticCategory.Error:
      return "error";
    case ts.DiagnosticCategory.Warning:
      return "warning";
    case ts.DiagnosticCategory.Suggestion:
      return "suggestion";
    case ts.DiagnosticCategory.Message:
      return "message";
    default:
      return "unknown";
  }
}

function extractContextLine(sourceFile: ts.SourceFile, offset: number): string {
  const start = sourceFile.getLineStarts();
  const { line } = ts.getLineAndCharacterOfPosition(sourceFile, offset);
  const lineStart = start[line];
  const lineEnd = line + 1 < start.length ? start[line + 1] : sourceFile.text.length;
  return sourceFile.text.slice(lineStart, lineEnd).trim();
}

function filePathFromTextSpan(
  service: ts.LanguageService,
  filePath: string,
  span: ts.TextSpan,
): {
  start: LspPosition;
  end: LspPosition;
  context: string;
} {
  const sourceFile = getSourceFileOrThrow(service, filePath);
  return {
    start: fromOffset(sourceFile, span.start),
    end: fromOffset(sourceFile, span.start + span.length),
    context: extractContextLine(sourceFile, span.start),
  };
}

export function getOpenAgentLspDiagnostics(args: {
  cwd: string;
  file: string;
  maxResults?: number;
}): LspDiagnosticResult {
  const context = createProjectContext(args.cwd, args.file);
  const diagnostics = context.service
    .getSemanticDiagnostics(context.absoluteFilePath)
    .concat(context.service.getSyntacticDiagnostics(context.absoluteFilePath));
  const sourceFile = getSourceFileOrThrow(context.service, context.absoluteFilePath);
  const maxResults = Math.max(1, args.maxResults ?? 100);

  return {
    filePath: context.absoluteFilePath,
    configPath: context.configPath,
    diagnostics: diagnostics.slice(0, maxResults).map((diagnostic) => ({
      filePath: diagnostic.file?.fileName ?? context.absoluteFilePath,
      category: diagnosticCategoryName(diagnostic.category),
      code: String(diagnostic.code),
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
      start:
        typeof diagnostic.start === "number"
          ? fromOffset(diagnostic.file ?? sourceFile, diagnostic.start)
          : { line: 1, character: 1 },
    })),
  };
}

export function getOpenAgentLspDefinitions(args: {
  cwd: string;
  file: string;
  line: number;
  character: number;
  maxResults?: number;
}): LspDefinitionResult {
  const context = createProjectContext(args.cwd, args.file);
  const sourceFile = getSourceFileOrThrow(context.service, context.absoluteFilePath);
  const offset = toOffset(sourceFile, { line: args.line, character: args.character });
  const quickInfo = context.service.getQuickInfoAtPosition(context.absoluteFilePath, offset);
  const definitions =
    context.service.getDefinitionAtPosition(context.absoluteFilePath, offset) ?? [];
  const maxResults = Math.max(1, args.maxResults ?? 25);

  return {
    filePath: context.absoluteFilePath,
    configPath: context.configPath,
    symbolName: quickInfo ? ts.displayPartsToString(quickInfo.displayParts) : "unknown symbol",
    definitions: definitions.slice(0, maxResults).map((definition) => ({
      filePath: definition.fileName,
      ...filePathFromTextSpan(context.service, definition.fileName, definition.textSpan),
    })),
  };
}

export function getOpenAgentLspReferences(args: {
  cwd: string;
  file: string;
  line: number;
  character: number;
  includeDeclaration?: boolean;
  maxResults?: number;
}): LspReferenceResult {
  const context = createProjectContext(args.cwd, args.file);
  const sourceFile = getSourceFileOrThrow(context.service, context.absoluteFilePath);
  const offset = toOffset(sourceFile, { line: args.line, character: args.character });
  const quickInfo = context.service.getQuickInfoAtPosition(context.absoluteFilePath, offset);
  const references =
    context.service.getReferencesAtPosition(context.absoluteFilePath, offset) ?? [];
  const definitions =
    context.service.getDefinitionAtPosition(context.absoluteFilePath, offset) ?? [];
  const definitionKeys = new Set(
    definitions.map(
      (definition) =>
        `${definition.fileName}:${definition.textSpan.start}:${definition.textSpan.length}`,
    ),
  );
  const includeDeclaration = args.includeDeclaration !== false;
  const filtered = includeDeclaration
    ? references
    : references.filter(
        (reference) =>
          !definitionKeys.has(
            `${reference.fileName}:${reference.textSpan.start}:${reference.textSpan.length}`,
          ),
      );
  const maxResults = Math.max(1, args.maxResults ?? 100);

  return {
    filePath: context.absoluteFilePath,
    configPath: context.configPath,
    symbolName: quickInfo ? ts.displayPartsToString(quickInfo.displayParts) : "unknown symbol",
    references: filtered.slice(0, maxResults).map((reference) => {
      const span = filePathFromTextSpan(context.service, reference.fileName, reference.textSpan);
      return {
        filePath: reference.fileName,
        start: span.start,
        context: span.context,
        isDefinition: definitionKeys.has(
          `${reference.fileName}:${reference.textSpan.start}:${reference.textSpan.length}`,
        ),
      };
    }),
  };
}

function applyTextChanges(content: string, edits: ts.RenameLocation[], newName: string): string {
  const ordered = [...edits].sort((left, right) => right.textSpan.start - left.textSpan.start);
  let nextContent = content;
  for (const edit of ordered) {
    nextContent =
      nextContent.slice(0, edit.textSpan.start) +
      newName +
      nextContent.slice(edit.textSpan.start + edit.textSpan.length);
  }
  return nextContent;
}

export async function runOpenAgentLspRename(args: {
  cwd: string;
  file: string;
  line: number;
  character: number;
  newName: string;
  apply?: boolean;
}): Promise<LspRenameResult> {
  const context = createProjectContext(args.cwd, args.file);
  const sourceFile = getSourceFileOrThrow(context.service, context.absoluteFilePath);
  const offset = toOffset(sourceFile, { line: args.line, character: args.character });
  const renameInfo = context.service.getRenameInfo(context.absoluteFilePath, offset, {
    allowRenameOfImportPath: false,
  });

  if (!renameInfo.canRename) {
    throw new Error(renameInfo.localizedErrorMessage || "TypeScript cannot rename the target symbol.");
  }

  const locations =
    context.service.findRenameLocations(
      context.absoluteFilePath,
      offset,
      false,
      false,
      true,
    ) ?? [];
  const editsByFile = new Map<string, ts.RenameLocation[]>();
  for (const location of locations) {
    const current = editsByFile.get(location.fileName) ?? [];
    current.push(location);
    editsByFile.set(location.fileName, current);
  }

  const fileEdits: LspRenameResult["fileEdits"] = [];
  for (const [filePath, locationsForFile] of editsByFile) {
    const fileSource = getSourceFileOrThrow(context.service, filePath);
    fileEdits.push({
      filePath,
      edits: locationsForFile.map((location) => ({
        start: fromOffset(fileSource, location.textSpan.start),
        end: fromOffset(fileSource, location.textSpan.start + location.textSpan.length),
        originalText: fileSource.text.slice(
          location.textSpan.start,
          location.textSpan.start + location.textSpan.length,
        ),
        newText: args.newName,
      })),
    });
  }

  if (args.apply) {
    const disallowed = [...editsByFile.keys()].filter(
      (filePath) => !isPathInsideRoot(args.cwd, filePath),
    );
    if (disallowed.length > 0) {
      throw new Error(
        `Refusing to apply rename outside the workspace root. Offending files: ${disallowed.join(", ")}`,
      );
    }

    for (const [filePath, locationsForFile] of editsByFile) {
      const currentContent = await readFile(filePath, "utf8");
      const nextContent = applyTextChanges(currentContent, locationsForFile, args.newName);
      await writeFile(filePath, nextContent, "utf8");
    }
  }

  return {
    filePath: context.absoluteFilePath,
    configPath: context.configPath,
    symbolName: renameInfo.displayName,
    canRename: true,
    fileEdits,
    applied: args.apply === true,
  };
}
