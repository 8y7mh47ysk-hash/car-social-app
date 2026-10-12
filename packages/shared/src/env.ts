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

/**
 * Validates environment variables against a Zod object schema and returns the typed result.
 *
 * - Only the variables the schema declares are read; everything else in `source` is ignored.
 * - An empty value counts as not set, so `NAME=` gets the default or is reported as missing,
 *   the way `${NAME:-default}` behaves in a shell and in Docker Compose.
 * - Every problem is collected before throwing, so one run shows everything that needs fixing.
 * - Messages never include values. Zod leaves the input out of its issues and its default
 *   messages; custom messages in env schemas must not add it back.
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

  const result = schema.safeParse(Object.fromEntries(input));
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
      // Any check on the value itself fails when the variable is unset (the code depends on the
      // schema: invalid_type, invalid_value for enums, invalid_union...), so say what is really
      // wrong. Custom refinements keep their message: they explain rules such as "required
      // when X is set".
      if (input.get(name) === undefined && issue.path.length === 1 && issue.code !== "custom") {
        const problem = source[name] === "" ? "is required but empty" : "is required but not set";
        return { variable: name, problem };
      }
      return { variable: name, problem: issue.message };
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
