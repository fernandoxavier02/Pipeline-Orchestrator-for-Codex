import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import ts from "typescript";

export interface RedValidationFailure {
  kind: "syntax" | "import" | "runtime" | "test";
  file: string;
  message: string;
}

export interface RedValidationResult {
  status: "approved" | "blocked";
  reasons: string[];
}

export interface DerivedExecutionProof {
  approvedScenarios: string[];
  tddApproval: "APPROVED" | "REJECTED";
  redValidation: RedValidationResult;
}

function createDefaultCompilerOptions() {
  return {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    esModuleInterop: true,
    strict: true,
    skipLibCheck: true,
  } satisfies ts.CompilerOptions;
}

function resolveCompilerOptions(cwd: string) {
  const configPath = ts.findConfigFile(cwd, ts.sys.fileExists, "tsconfig.json");
  if (!configPath) {
    return createDefaultCompilerOptions();
  }

  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  if (configFile.error) {
    return createDefaultCompilerOptions();
  }

  const parsedConfig = ts.parseJsonConfigFileContent(configFile.config, ts.sys, cwd);
  return {
    ...createDefaultCompilerOptions(),
    ...parsedConfig.options,
  } satisfies ts.CompilerOptions;
}

function toAbsoluteScenarioPaths(approvedScenarios: string[], cwd: string) {
  return approvedScenarios
    .map((scenario) => resolve(cwd, scenario))
    .filter((scenarioPath, index, allScenarioPaths) => allScenarioPaths.indexOf(scenarioPath) === index);
}

function isProofScenarioPath(scenarioPath: string, cwd: string) {
  const normalizedScenarioPath = scenarioPath.replace(/\\/g, "/");
  const normalizedTestsRoot = resolve(cwd, "tests").replace(/\\/g, "/");

  return normalizedScenarioPath.startsWith(normalizedTestsRoot)
    && /\.test\.ts$/i.test(basename(normalizedScenarioPath));
}

function containsTestDeclaration(sourceText: string) {
  return /\b(?:it|test)\s*\(/u.test(sourceText);
}

function formatDiagnosticMessage(diagnostic: ts.Diagnostic) {
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
}

export function createPreTester() {
  const collectFailures = (input: {
    approvedScenarios: string[];
    cwd?: string;
  }): RedValidationFailure[] => {
    const cwd = input.cwd ?? process.cwd();
    const approvedScenarioPaths = toAbsoluteScenarioPaths(input.approvedScenarios, cwd);
    const compilerOptions = resolveCompilerOptions(cwd);
    const failures: RedValidationFailure[] = [];
    const seenFailures = new Set<string>();

    const appendFailure = (failure: RedValidationFailure) => {
      const key = `${failure.kind}:${failure.file}:${failure.message}`;
      if (seenFailures.has(key)) {
        return;
      }

      seenFailures.add(key);
      failures.push(failure);
    };

    for (const scenarioPath of approvedScenarioPaths) {
      if (!existsSync(scenarioPath)) {
        appendFailure({
          kind: "test",
          file: scenarioPath,
          message: "Approved scenario does not exist",
        });
        continue;
      }

      if (!isProofScenarioPath(scenarioPath, cwd)) {
        appendFailure({
          kind: "test",
          file: scenarioPath,
          message: "Approved scenario is not a real test proof input",
        });
        continue;
      }

      const sourceText = readFileSync(scenarioPath, "utf8");
      if (!containsTestDeclaration(sourceText)) {
        appendFailure({
          kind: "test",
          file: scenarioPath,
          message: "Approved scenario does not declare a runnable test",
        });
        continue;
      }

      const transpileResult = ts.transpileModule(sourceText, {
        compilerOptions,
        fileName: scenarioPath,
        reportDiagnostics: true,
      });

      for (const diagnostic of transpileResult.diagnostics ?? []) {
        appendFailure({
          kind: "syntax",
          file: scenarioPath,
          message: formatDiagnosticMessage(diagnostic),
        });
      }

      const imports = ts.preProcessFile(sourceText, true, true);
      for (const importedFile of imports.importedFiles) {
        if (!importedFile.fileName.startsWith(".")) {
          continue;
        }

        const resolvedModule = ts.resolveModuleName(
          importedFile.fileName,
          scenarioPath,
          compilerOptions,
          ts.sys,
        ).resolvedModule;

        if (!resolvedModule) {
          appendFailure({
            kind: "import",
            file: scenarioPath,
            message: `Cannot find module '${importedFile.fileName}'`,
          });
        }
      }
    }

    return failures;
  };

  const validateRedState = (input: {
    approvedScenarios: string[];
    failures: RedValidationFailure[];
  }): RedValidationResult => {
    const reasons: string[] = [];

      if (input.approvedScenarios.length === 0) {
        reasons.push("No approved test scenarios were supplied");
      }

      for (const failure of input.failures) {
        if (failure.kind === "syntax" || failure.kind === "import" || failure.kind === "test") {
          reasons.push(`${failure.kind} failure in ${failure.file}: ${failure.message}`);
        }
      }

    if (reasons.length > 0) {
      return {
        status: "blocked",
        reasons,
      };
    }

    return {
      status: "approved",
      reasons: ["RED validation passed for approved scenarios"],
    };
  };

  return {
    collectFailures,
    validateRedState,
    deriveExecutionProof(input: {
      approvedScenarios: string[];
      cwd?: string;
      failures?: RedValidationFailure[];
    }): DerivedExecutionProof {
      const approvedScenarios = [...input.approvedScenarios];
      const failures = input.failures ?? collectFailures({
        approvedScenarios,
        cwd: input.cwd,
      });
      const redValidation = validateRedState({
        approvedScenarios,
        failures,
      });
      const validScenarioPaths = toAbsoluteScenarioPaths(approvedScenarios, input.cwd ?? process.cwd()).filter((scenarioPath) => {
        if (!existsSync(scenarioPath) || !isProofScenarioPath(scenarioPath, input.cwd ?? process.cwd())) {
          return false;
        }

        return containsTestDeclaration(readFileSync(scenarioPath, "utf8"));
      });
      const normalizedValidScenarios = validScenarioPaths.map((scenarioPath) => scenarioPath.replace(/\\/g, "/").replace(`${(input.cwd ?? process.cwd()).replace(/\\/g, "/")}/`, ""));

      return {
        approvedScenarios: normalizedValidScenarios,
        tddApproval: normalizedValidScenarios.length > 0 ? "APPROVED" : "REJECTED",
        redValidation,
      };
    },
  };
}
