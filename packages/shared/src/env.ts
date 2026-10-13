import { z } from "zod";

/**
 * Environment variables as a process receives them, such as Node.js's `process.env`: names
 * mapped to string values, with no entry (or `undefined`) for a variable that is not set.
 */
export type EnvSource = Readonly<Record<string, string | undefined>>;

/** One problem with one environment variable. It never includes the variable's value. */
export interface EnvIssue {
  /** The variable's name, such as `API_PORT`, or "(environment)" for a rule about several. */
  readonly variable: string;
  /** What is wrong, such as "is required but not set". */
  readonly problem: string;
}

/** Wording for the error message: whose variables are wrong and where to fix them. */
export interface ParseEnvOptions {
  /** The program that reads the variables, such as "the API". */
  readonly app: string;
  /** The message's last line, such as "Set them in apps/api/.env or in the environment." */
  readonly hint: string;
}

/**
 * Thrown when environment variables are missing or invalid. The message lists every problem by
 * variable name and never includes a value, so it is safe to print and to log.
 */
export class EnvValidationError extends Error {
  override readonly name = "EnvValidationError";
  /** Every problem found, in the order the schema declares the variables. */
  readonly issues: readonly EnvIssue[];

  constructor(options: ParseEnvOptions, issues: readonly EnvIssue[]) {
    super(
      [
        `Invalid environment variables for ${options.app} (values are not shown):`,
        ...issues.map(({ variable, problem }) => `  - ${variable}: ${problem}`),
        options.hint,
      ].join("\n"),
    );
    this.issues = issues;
  }
}

const THROWN = "its check threw an error, which is not shown because it may contain the value";
const THROWN_BY_RULE =
  "a rule about several variables threw an error, which is not shown because it may contain a value";

/**
 * Validates environment variables against a Zod object schema and returns the typed result.
 *
 * - Only the variables the schema declares are read; everything else in `source` is ignored.
 * - An empty value counts as not set, so `NAME=` gets the default or is reported as missing,
 *   the way `${NAME:-default}` behaves in a shell and in Docker Compose.
 * - Every problem is collected before throwing, so one run shows everything that needs fixing.
 * - Messages never include values. Zod leaves the input out of its issues and its default
 *   messages; custom messages in env schemas must not add it back. An error thrown inside a
 *   check or a transform (`JSON.parse` and `new URL` throw on bad input) is never passed on,
 *   because it can quote the value; the variable is reported as one whose check threw.
 *
 * @throws {EnvValidationError} if a required variable is missing or any value is invalid.
 */
export function parseEnv<Schema extends z.ZodObject>(
  schema: Schema,
  source: EnvSource,
  options: ParseEnvOptions,
): z.output<Schema> {
  const input = new Map<string, string | undefined>();
  for (const name of Object.keys(schema.shape)) {
    const value = source[name];
    input.set(name, value === "" ? undefined : value);
  }

  /** One Zod issue about variable `name`; `onValue` is false for an issue about a part of it. */
  const describe = (name: string, issue: z.core.$ZodIssue, onValue: boolean): EnvIssue => {
    // Any check on the value itself fails when the variable is unset (the code depends on the
    // schema: invalid_type, invalid_value for enums, invalid_union...), so say what is really
    // wrong. Custom refinements keep their message: they explain rules such as "required when X
    // is set".
    if (input.get(name) === undefined && onValue && issue.code !== "custom") {
      const problem = source[name] === "" ? "is required but empty" : "is required but not set";
      return { variable: name, problem };
    }
    return { variable: name, problem: issue.message };
  };

  let result: z.ZodSafeParseResult<z.output<Schema>>;
  try {
    result = schema.safeParse(Object.fromEntries(input));
  } catch {
    // Zod reports failed checks as issues, but an error thrown inside a check or a transform
    // passes straight through it, and such an error can carry the value: JSON.parse quotes it in
    // its message, and Node.js prints a URL error's `input` property when the process crashes.
    // So the error is dropped, and the variables are checked one at a time to name each one whose
    // own schema throws and still report every other problem.
    const issues: EnvIssue[] = [];
    for (const [name, variableSchema] of Object.entries<z.ZodType>(schema.shape)) {
      try {
        const variableResult = z.safeParse(variableSchema, input.get(name));
        for (const issue of variableResult.error?.issues ?? []) {
          issues.push(describe(name, issue, issue.path.length === 0));
        }
      } catch {
        issues.push({ variable: name, problem: THROWN });
      }
    }
    if (!issues.some(({ problem }) => problem === THROWN)) {
      // No variable's own schema throws, so a rule about several of them did.
      issues.push({ variable: "(environment)", problem: THROWN_BY_RULE });
    }
    throw new EnvValidationError(options, issues);
  }

  if (result.success) {
    return result.data;
  }
  throw new EnvValidationError(
    options,
    result.error.issues.map((issue): EnvIssue => {
      const [name] = issue.path;
      if (typeof name !== "string") {
        // A rule about how variables combine, rather than about one of them.
        return { variable: "(environment)", problem: issue.message };
      }
      return describe(name, issue, issue.path.length === 1);
    }),
  );
}

const PORT_PROBLEM = "must be a whole number from 0 to 65535";

/** A TCP port written as digits, from 0 to 65535. 0 lets the operating system pick a free port. */
export const envPortSchema = z
  .string()
  .regex(/^\d{1,5}$/, PORT_PROBLEM)
  .transform(Number)
  .pipe(z.number().max(65_535, PORT_PROBLEM));

/**
 * A host to listen on or connect to: an IPv4 or IPv6 address (without brackets), or a hostname.
 * A hostname's last label is never all digits (RFC 3696), so values such as 999.0.0.1, 1.2.3 or
 * 4000 are rejected as mistyped addresses instead of failing later in a DNS lookup.
 */
export const envHostSchema = z.union(
  [z.ipv4(), z.ipv6(), z.hostname().refine((name) => !/(?:^|\.)\d+\.?$/.test(name))],
  { error: "must be an IP address such as 127.0.0.1, or a hostname such as localhost" },
);
