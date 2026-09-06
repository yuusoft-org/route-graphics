import ts from "typescript";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const buildTypes = () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const config = ts.readConfigFile(
    path.join(root, "tsconfig.types.json"),
    ts.sys.readFile,
  );
  if (config.error)
    throw new Error(
      ts.flattenDiagnosticMessageText(config.error.messageText, "\n"),
    );
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const emitted = program.emit();
  const diagnostics = [
    ...parsed.errors,
    ...ts.getPreEmitDiagnostics(program),
    ...emitted.diagnostics,
  ];
  if (diagnostics.length || emitted.emitSkipped) {
    throw new Error(
      ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCanonicalFileName: (file) => file,
        getCurrentDirectory: () => root,
        getNewLine: () => "\n",
      }),
    );
  }
};
