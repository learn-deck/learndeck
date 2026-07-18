import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { access, readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Parser } from "@asyncapi/parser";
import type {
  Ajv as AjvInstance,
  AnySchema,
  Options,
  ValidateFunction,
} from "ajv";
import YAML from "yaml";

type DataObject = Record<string, unknown>;
type Gate = { gateId: string } & DataObject;
type Operation = {
  operationId: string;
  parameters?: unknown[];
  requestBody?: { content?: Record<string, { schema: unknown }> };
  responses?: Record<string, unknown>;
  security?: DataObject[];
};
type OperationEntry = { method: string; route: string; operation: Operation };
type Parameter = {
  in: string;
  name: string;
  required?: boolean;
  schema: unknown;
};
type HttpInput = {
  kind: "http";
  operationId: string;
  sequence: number;
  request: {
    pathParams: DataObject;
    headers?: Record<string, string>;
    body?: unknown;
  };
  expect: {
    status: number;
    response: unknown;
    captures?: DataObject;
  };
  await?: { captures?: DataObject };
};
type IntegrationInput = {
  kind: "integrationMessage";
  messageType: string;
  sequence: number;
  body: DataObject & { sameAsSequence?: number };
  expectedContractValidity: "valid" | "invalid";
  expect?: { captures?: DataObject };
  await?: { captures?: DataObject };
};
type ScenarioInput = HttpInput | IntegrationInput;
type PublishedMessage = DataObject & {
  messageType: string;
  payloadSubset: DataObject;
  captures?: DataObject;
};
type Scenario = {
  inputs: ScenarioInput[];
  expected: DataObject & {
    publishedMessages?: PublishedMessage[];
  };
  fixtureControls?: unknown;
  identities?: unknown;
  initialState?: unknown;
};
type Catalog = {
  schemaFiles: string[];
  http: { openapi: string; operations: string[] };
  integrationMessages: {
    asyncapi: string;
    commandsByIssuer: Record<string, string[]>;
    commandsByRecipient: Record<string, string[]>;
    missionRetryReasons: string[];
    eventsByProducer: Record<string, string[]>;
  };
};
type OpenApi = { paths: Record<string, Record<string, Operation>> };
type AsyncMessage = {
  name: string;
  payload: { $ref: string };
  "x-message-kind"?: unknown;
  "x-issuer"?: unknown;
  "x-recipient"?: unknown;
  "x-producer"?: unknown;
};
type AsyncChannel = {
  address: string;
  messages?: Record<string, { $ref?: string }>;
};
type AsyncOperation = {
  action: string;
  channel?: { $ref?: string };
  messages?: Array<{ $ref?: string }>;
};
type AsyncApi = {
  components: { messages: Record<string, AsyncMessage> };
  channels: Record<string, AsyncChannel>;
  operations: Record<string, AsyncOperation>;
};
type OwnerMetadata = {
  kind: "command" | "event";
  issuer?: string;
  recipient?: string;
  producer?: string;
};

const require = createRequire(import.meta.url);
const Ajv2020: new (
  options?: Options,
) => AjvInstance = require("ajv/dist/2020.js");
const addFormats: typeof import("ajv-formats").default = require("ajv-formats");

const nodeRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const root = path.resolve(nodeRoot, "..");
const schemaRoot = path.join(root, "contracts/schemas/v1");

const isObject = (value: unknown): value is DataObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function objectAtBoundary(value: unknown, label: string): DataObject {
  if (!isObject(value)) throw new Error(`${label}: expected an object`);
  return value;
}

function parseBoundary<T extends object>(value: unknown, label: string): T {
  objectAtBoundary(value, label);
  return value as T;
}

function schemaAtBoundary(value: unknown, label: string): AnySchema {
  if (typeof value === "boolean" || isObject(value)) return value as AnySchema;
  throw new Error(`${label}: expected a JSON Schema`);
}

const readJson = async (file: string): Promise<unknown> => {
  const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
  return parsed;
};
const readYaml = async (file: string): Promise<unknown> => {
  const parsed: unknown = YAML.parse(await readFile(file, "utf8"));
  return parsed;
};
const flatten = (object: Record<string, string[]>): string[] =>
  Object.values(object).flat();

function walkValue(
  value: unknown,
  visit: (value: unknown, pointer: string) => void,
  pointer = "#",
): void {
  visit(value, pointer);
  if (Array.isArray(value))
    value.forEach((item, index) =>
      walkValue(item, visit, `${pointer}/${index}`),
    );
  else if (isObject(value)) {
    for (const [key, item] of Object.entries(value))
      walkValue(item, visit, `${pointer}/${key}`);
  }
}

function dereferencePointer(document: unknown, fragment: string): unknown {
  if (!fragment || fragment === "#") return document;
  if (!fragment.startsWith("#/"))
    throw new Error(`unsupported reference fragment: ${fragment}`);
  let value = document;
  for (const token of fragment.slice(2).split("/")) {
    if (!isObject(value) && !Array.isArray(value)) return undefined;
    const key = token.replaceAll("~1", "/").replaceAll("~0", "~");
    value = Array.isArray(value) ? value[Number(key)] : value[key];
  }
  return value;
}

async function verifyReferences(
  document: unknown,
  sourceFile: string,
): Promise<number> {
  const refs: string[] = [];
  walkValue(document, (value, pointer) => {
    if (isObject(value) && "$ref" in value) {
      const reference = value["$ref"];
      if (typeof reference !== "string" || reference.trim() !== reference)
        throw new Error(`${sourceFile}${pointer}: invalid $ref syntax`);
      refs.push(reference);
    }
  });
  for (const reference of refs) {
    const [targetText = "", fragment = ""] = reference.split("#", 2);
    let targetFile = sourceFile;
    if (
      targetText.startsWith("https://schemas.patchquest.example/contracts/v1/")
    ) {
      targetFile = path.join(
        schemaRoot,
        path.basename(new URL(targetText).pathname),
      );
    } else if (targetText.startsWith("https://")) {
      continue;
    } else if (targetText) {
      targetFile = path.resolve(path.dirname(sourceFile), targetText);
    }
    await access(targetFile);
    const target = targetFile.endsWith(".json")
      ? await readJson(targetFile)
      : await readYaml(targetFile);
    if (
      dereferencePointer(target, fragment ? `#${fragment}` : "#") === undefined
    ) {
      throw new Error(`${sourceFile}: unresolved ${reference}`);
    }
  }
  return refs.length;
}

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

const scenarioReferencePattern =
  /^\$\{(?:capture\.([A-Za-z0-9_-]+)|input\.([1-9][0-9]*)\.(requestId|commandId|eventId))\}$/;

function operationEntries(openapi: OpenApi): Map<string, OperationEntry> {
  const entries = new Map<string, OperationEntry>();
  for (const [route, pathItem] of Object.entries(openapi.paths)) {
    for (const method of ["get", "post", "put", "patch", "delete"]) {
      const operation = pathItem[method];
      if (operation?.operationId)
        entries.set(operation.operationId, { method, route, operation });
    }
  }
  return entries;
}

async function resolveSchema(
  schema: unknown,
  document: unknown,
  sourceFile: string,
  seen: Set<string> = new Set(),
): Promise<unknown> {
  if (!isObject(schema) && !Array.isArray(schema)) return schema;
  if (Array.isArray(schema))
    return Promise.all(
      schema.map((item) => resolveSchema(item, document, sourceFile, seen)),
    );
  if (isObject(schema) && typeof schema["$ref"] === "string") {
    const reference = schema["$ref"];
    const key = `${sourceFile}:${reference}`;
    if (seen.has(key)) throw new Error(`recursive schema reference ${key}`);
    const [targetText, fragment = ""] = reference.split("#", 2);
    const targetFile = targetText
      ? path.resolve(path.dirname(sourceFile), targetText)
      : sourceFile;
    const targetDocument = targetText
      ? targetFile.endsWith(".json")
        ? await readJson(targetFile)
        : await readYaml(targetFile)
      : document;
    const target = dereferencePointer(
      targetDocument,
      fragment ? `#${fragment}` : "#",
    );
    if (target === undefined) throw new Error(`unresolved schema ${key}`);
    return resolveSchema(
      target,
      targetDocument,
      targetFile,
      new Set([...seen, key]),
    );
  }
  const resolved: DataObject = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "$id" || key === "$schema") continue;
    resolved[key] = await resolveSchema(value, document, sourceFile, seen);
  }
  return resolved;
}

function responseSubsetSchema(schema: unknown): unknown {
  if (!isObject(schema) && !Array.isArray(schema)) return schema;
  if (Array.isArray(schema)) return schema.map(responseSubsetSchema);
  return Object.fromEntries(
    Object.entries(schema)
      .filter(([key]) => key !== "required")
      .map(([key, value]) => [key, responseSubsetSchema(value)]),
  );
}

function representativeValue(schema: unknown): unknown {
  const schemaObject = isObject(schema) ? schema : {};
  const alternatives = Array.isArray(schemaObject["oneOf"])
    ? schemaObject["oneOf"]
    : Array.isArray(schemaObject["anyOf"])
      ? schemaObject["anyOf"]
      : [];
  const candidate = isObject(alternatives[0]) ? alternatives[0] : schemaObject;
  if (candidate["const"] !== undefined) return candidate["const"];
  const enumValues = candidate["enum"];
  if (Array.isArray(enumValues) && enumValues.length > 0) return enumValues[0];
  const properties = isObject(candidate["properties"])
    ? candidate["properties"]
    : {};
  if (candidate["type"] === "object" || candidate["properties"]) {
    const result: DataObject = {};
    const required = Array.isArray(candidate["required"])
      ? candidate["required"].filter(
          (value): value is string => typeof value === "string",
        )
      : [];
    for (const key of required)
      result[key] = representativeValue(properties[key] ?? {});
    return result;
  }
  if (candidate["type"] === "array") return [];
  if (candidate["type"] === "integer" || candidate["type"] === "number")
    return 1;
  if (candidate["type"] === "boolean") return true;
  if (candidate["format"] === "uuid")
    return "00000000-0000-4000-8000-000000000000";
  if (candidate["format"] === "date-time") return "2026-01-01T00:00:00Z";
  if (candidate["pattern"] === "^[a-f0-9]{64}$") return "a".repeat(64);
  if (typeof candidate["minLength"] === "number")
    return "x".repeat(candidate["minLength"]);
  return "scenario-reference";
}

function propertySchema(schema: unknown, key: string): unknown {
  if (!isObject(schema)) return {};
  const properties = isObject(schema["properties"]) ? schema["properties"] : {};
  if (key in properties) return properties[key];
  for (const composition of ["allOf", "oneOf", "anyOf"] as const) {
    const alternatives = schema[composition];
    if (!Array.isArray(alternatives)) continue;
    for (const alternative of [...alternatives].reverse()) {
      const nested = propertySchema(alternative, key);
      if (isObject(nested) && Object.keys(nested).length === 0) continue;
      return nested;
    }
  }
  return {};
}

function materializeScenarioReferences(
  value: unknown,
  schema: unknown,
): unknown {
  if (typeof value === "string" && scenarioReferencePattern.test(value))
    return representativeValue(schema);
  if (Array.isArray(value))
    return value.map((item) =>
      materializeScenarioReferences(
        item,
        isObject(schema) ? (schema["items"] ?? {}) : {},
      ),
    );
  if (isObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        materializeScenarioReferences(item, propertySchema(schema, key)),
      ]),
    );
  }
  return value;
}

function validateInstance(
  ajv: AjvInstance,
  schema: unknown,
  value: unknown,
  label: string,
): void {
  const validate: ValidateFunction = ajv.compile(
    schemaAtBoundary(schema, `${label} schema`),
  );
  if (!validate(materializeScenarioReferences(value, schema)))
    throw new Error(`${label}: ${ajv.errorsText(validate.errors)}`);
}

async function verifyHttpScenarioContracts(
  openapi: OpenApi,
  openapiFile: string,
  ajv: AjvInstance,
): Promise<number> {
  const operations = operationEntries(openapi);
  const coveredOperations = new Set<string>();
  const scenarioDir = path.join(root, "acceptance/scenarios");
  let requests = 0;
  for (const name of await readdir(scenarioDir)) {
    if (!name.endsWith(".json")) continue;
    const scenario = parseBoundary<Scenario>(
      await readJson(path.join(scenarioDir, name)),
      name,
    );
    for (const input of scenario.inputs) {
      if (input.kind !== "http") continue;
      const entry = operations.get(input.operationId);
      if (!entry)
        throw new Error(`${name}: unknown HTTP operation ${input.operationId}`);
      const parameters = await Promise.all(
        (entry.operation.parameters ?? []).map(async (parameter) =>
          parseBoundary<Parameter>(
            await resolveSchema(parameter, openapi, openapiFile),
            `${name}: parameter`,
          ),
        ),
      );
      const pathParameters = parameters.filter(
        (parameter) => parameter.in === "path",
      );
      const expectedPathNames = [...entry.route.matchAll(/\{([^}]+)\}/g)].map(
        (match) => match[1],
      );
      const actualPathNames = Object.keys(input.request.pathParams).sort();
      if (
        JSON.stringify(actualPathNames) !==
        JSON.stringify(expectedPathNames.sort())
      )
        throw new Error(
          `${name}: ${input.operationId} path parameters do not match ${entry.route}`,
        );
      for (const parameter of pathParameters)
        validateInstance(
          ajv,
          await resolveSchema(parameter.schema, openapi, openapiFile),
          input.request.pathParams[parameter.name],
          `${name}: ${input.operationId} path ${parameter.name}`,
        );
      const headerParameters = parameters.filter(
        (parameter) => parameter.in === "header",
      );
      const headers = input.request.headers ?? {};
      for (const parameter of headerParameters) {
        if (parameter.required && !(parameter.name in headers))
          throw new Error(
            `${name}: ${input.operationId} missing required header ${parameter.name}`,
          );
        if (parameter.name in headers)
          validateInstance(
            ajv,
            await resolveSchema(parameter.schema, openapi, openapiFile),
            headers[parameter.name],
            `${name}: ${input.operationId} header ${parameter.name}`,
          );
      }
      const knownHeaders = new Set(
        headerParameters.map((parameter) => parameter.name),
      );
      const bearerRequired = (entry.operation.security ?? []).some(
        (requirement) => "bearerAuth" in requirement,
      );
      if (bearerRequired) {
        if (!/^Bearer .+/.test(headers["Authorization"] ?? ""))
          throw new Error(
            `${name}: ${input.operationId} requires bearer Authorization`,
          );
        knownHeaders.add("Authorization");
      } else if ("Authorization" in headers) {
        throw new Error(
          `${name}: ${input.operationId} must not invent Authorization`,
        );
      }
      const extraHeaders = Object.keys(headers).filter(
        (header) => !knownHeaders.has(header),
      );
      if (extraHeaders.length > 0)
        throw new Error(
          `${name}: ${input.operationId} unknown headers ${extraHeaders.join(", ")}`,
        );
      const requestContent =
        entry.operation.requestBody?.content?.["application/json"];
      if (requestContent)
        validateInstance(
          ajv,
          await resolveSchema(requestContent.schema, openapi, openapiFile),
          input.request.body,
          `${name}: ${input.operationId} request body`,
        );
      else if ("body" in input.request)
        throw new Error(
          `${name}: ${input.operationId} does not define a request body`,
        );
      const response = entry.operation.responses?.[String(input.expect.status)];
      if (!response)
        throw new Error(
          `${name}: ${input.operationId} does not define status ${input.expect.status}`,
        );
      const resolvedResponse = await resolveSchema(
        response,
        openapi,
        openapiFile,
      );
      const responseObject = objectAtBoundary(
        resolvedResponse,
        `${name}: response`,
      );
      const responseContentMap = isObject(responseObject["content"])
        ? responseObject["content"]
        : {};
      const responseContent =
        responseContentMap["application/json"] ??
        responseContentMap["application/problem+json"];
      if (!responseContent)
        throw new Error(
          `${name}: ${input.operationId} status ${input.expect.status} has no JSON response`,
        );
      validateInstance(
        ajv,
        responseSubsetSchema(
          await resolveSchema(
            objectAtBoundary(responseContent, `${name}: response content`)[
              "schema"
            ],
            openapi,
            openapiFile,
          ),
        ),
        input.expect.response,
        `${name}: ${input.operationId} response subset`,
      );
      requests += 1;
      coveredOperations.add(input.operationId);
    }
  }
  const missingOperations = [...operations.keys()].filter(
    (operationId) => !coveredOperations.has(operationId),
  );
  if (missingOperations.length > 0)
    throw new Error(
      `HTTP scenario coverage missing operations: ${missingOperations.join(", ")}`,
    );
  return requests;
}

export function gateSetDigest(gates: Gate[]): string {
  const sorted = structuredClone(gates).sort((left, right) =>
    left.gateId.localeCompare(right.gateId, "en"),
  );
  return createHash("sha256").update(canonicalize(sorted)).digest("hex");
}

async function verifyContracts(): Promise<void> {
  const catalog = parseBoundary<Catalog>(
    await readJson(path.join(schemaRoot, "catalog.json")),
    "catalog.json",
  );
  const schemas = await Promise.all(
    catalog.schemaFiles.map((name: string) =>
      readJson(path.join(schemaRoot, name)).then((schema) =>
        parseBoundary<DataObject>(schema, name),
      ),
    ),
  );
  const files = catalog.schemaFiles.map((name: string) =>
    path.join(schemaRoot, name),
  );
  const openapiFile = path.resolve(schemaRoot, catalog.http.openapi);
  const asyncapiFile = path.resolve(
    schemaRoot,
    catalog.integrationMessages.asyncapi,
  );
  const openapi = parseBoundary<OpenApi>(
    await readYaml(openapiFile),
    openapiFile,
  );
  const asyncapi = parseBoundary<AsyncApi>(
    await readYaml(asyncapiFile),
    asyncapiFile,
  );
  const asyncapiResult = await new Parser().parse(
    await readFile(asyncapiFile, "utf8"),
    { source: asyncapiFile },
  );
  const asyncapiErrors = asyncapiResult.diagnostics.filter(
    (diagnostic) => diagnostic.severity === 0,
  );
  if (!asyncapiResult.document || asyncapiErrors.length > 0)
    throw new Error(
      `AsyncAPI semantic validation failed:\n${asyncapiErrors
        .map((diagnostic) => diagnostic.message)
        .join("\n")}`,
    );
  for (let index = 0; index < schemas.length; index += 1) {
    const schema = schemas[index];
    const file = files[index];
    if (!schema || !file) throw new Error("schema catalog parity failed");
    await verifyReferences(schema, file);
  }
  await verifyReferences(openapi, openapiFile);
  await verifyReferences(asyncapi, asyncapiFile);
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    strictRequired: false,
    strictTypes: false,
  });
  addFormats(ajv);
  for (const schema of schemas)
    ajv.addSchema(schemaAtBoundary(schema, "contract schema"));
  for (const schema of schemas) {
    const schemaId = schema["$id"];
    if (typeof schemaId !== "string")
      throw new Error("contract schema is missing $id");
    ajv.getSchema(schemaId);
  }

  const httpFixtures = await verifyHttpScenarioContracts(
    openapi,
    openapiFile,
    ajv,
  );

  const payloadSchemas: Array<[string, string]> = Object.values(
    asyncapi.components.messages,
  ).map((message) => [message.name, message.payload.$ref]);
  const validators = new Map<
    string,
    { full: ValidateFunction; subset: ValidateFunction }
  >(
    await Promise.all(
      payloadSchemas.map(async ([name, reference]) => {
        const fragment = reference.split("#", 2)[1] ?? "";
        const schemaId = schemas.find((schema) =>
          typeof schema["$id"] === "string"
            ? reference.includes(path.basename(new URL(schema["$id"]).pathname))
            : false,
        )?.["$id"];
        if (typeof schemaId !== "string")
          throw new Error(`missing schema id for ${name}`);
        const validate = ajv.getSchema(`${schemaId}#${fragment}`);
        if (!validate) throw new Error(`missing payload validator for ${name}`);
        const resolvedPayload = await resolveSchema(
          { $ref: reference },
          asyncapi,
          asyncapiFile,
        );
        const subset = ajv.compile(
          schemaAtBoundary(
            responseSubsetSchema(resolvedPayload),
            `${name} payload subset schema`,
          ),
        );
        return [name, { full: validate, subset }] as const;
      }),
    ),
  );
  const scenarioDir = path.join(root, "acceptance/scenarios");
  let validPayloads = 0;
  let invalidPayloads = 0;
  let publishedPayloadSubsets = 0;
  for (const name of await readdir(scenarioDir)) {
    if (!name.endsWith(".json")) continue;
    const scenario = parseBoundary<Scenario>(
      await readJson(path.join(scenarioDir, name)),
      name,
    );
    const inputsBySequence = new Map<number, ScenarioInput>(
      scenario.inputs.map((input) => [input.sequence, input]),
    );
    for (const input of scenario.inputs) {
      if (input.kind !== "integrationMessage") continue;
      const pair = validators.get(input.messageType);
      if (!pair) throw new Error(`${name}: unknown ${input.messageType}`);
      const validate = pair.full;
      const referencedInput = input.body.sameAsSequence
        ? inputsBySequence.get(input.body.sameAsSequence)
        : undefined;
      const body = input.body.sameAsSequence
        ? referencedInput?.kind === "integrationMessage"
          ? referencedInput.body
          : undefined
        : input.body;
      if (!body) throw new Error(`${name}: unresolved sameAsSequence`);
      const valid = validate(body);
      if (valid !== (input.expectedContractValidity === "valid"))
        throw new Error(
          `${name}: ${input.messageType} expected ${input.expectedContractValidity}: ${ajv.errorsText(validate.errors)}`,
        );
      if (valid) validPayloads += 1;
      else invalidPayloads += 1;
    }
    for (const published of scenario.expected.publishedMessages ?? []) {
      const pair = validators.get(published.messageType);
      if (!pair) throw new Error(`${name}: unknown ${published.messageType}`);
      if (
        !pair.subset(
          materializeScenarioReferences(
            published.payloadSubset,
            pair.subset.schema,
          ),
        )
      )
        throw new Error(
          `${name}: ${published.messageType} payloadSubset is incompatible with its AsyncAPI payload: ${ajv.errorsText(pair.subset.errors)}`,
        );
      publishedPayloadSubsets += 1;
    }
  }
  if (validPayloads === 0 || invalidPayloads === 0)
    throw new Error("expected representative valid and invalid payloads");

  const operationIds = Object.values(openapi.paths).flatMap((item) =>
    Object.values(item)
      .map((operation) => operation.operationId)
      .filter((operationId): operationId is string => Boolean(operationId)),
  );
  const catalogOperations = catalog.http.operations;
  if (
    JSON.stringify([...operationIds].sort()) !==
    JSON.stringify([...catalogOperations].sort())
  )
    throw new Error("OpenAPI operationId/catalog parity failed");
  const catalogMessages = [
    ...flatten(catalog.integrationMessages.commandsByIssuer),
    ...flatten(catalog.integrationMessages.eventsByProducer),
  ];
  const asyncapiMessages = Object.values(asyncapi.components.messages).map(
    (message) => message.name,
  );
  if (
    JSON.stringify([...asyncapiMessages].sort()) !==
    JSON.stringify([...catalogMessages].sort())
  )
    throw new Error("AsyncAPI message/catalog parity failed");
  if (new Set(catalogMessages).size !== 15)
    throw new Error("expected exactly 15 unique integration messages");
  const integrationSchema = schemas.find((schema) =>
    typeof schema["$id"] === "string"
      ? schema["$id"].endsWith("/integration-messages.schema.json")
      : false,
  );
  if (!integrationSchema)
    throw new Error("integration message schema is missing");
  const definitions = objectAtBoundary(
    integrationSchema["$defs"],
    "integration message definitions",
  );
  const retryDefinition = objectAtBoundary(
    definitions["MissionRetryAuthorizedV1"],
    "mission retry definition",
  );
  const retryAllOf = retryDefinition["allOf"];
  if (!Array.isArray(retryAllOf) || retryAllOf.length !== 2)
    throw new Error("mission retry definition must have two allOf branches");
  const retryPayload = objectAtBoundary(retryAllOf[1], "mission retry payload");
  const retryProperties = objectAtBoundary(
    retryPayload["properties"],
    "mission retry properties",
  );
  const retryData = objectAtBoundary(
    retryProperties["data"],
    "mission retry data",
  );
  const retryDataProperties = objectAtBoundary(
    retryData["properties"],
    "mission retry data properties",
  );
  const retryReason = objectAtBoundary(
    retryDataProperties["reason"],
    "mission retry reason",
  );
  const retryReasonEnum = retryReason["enum"];
  if (
    !Array.isArray(retryReasonEnum) ||
    !retryReasonEnum.every((reason) => typeof reason === "string") ||
    JSON.stringify([...retryReasonEnum].sort()) !==
      JSON.stringify(
        [...catalog.integrationMessages.missionRetryReasons].sort(),
      )
  )
    throw new Error("mission retry reason schema/catalog parity failed");

  const componentByName = new Map<
    string,
    { key: string; message: AsyncMessage }
  >(
    Object.entries(asyncapi.components.messages).map(([key, message]) => [
      message.name,
      { key, message },
    ]),
  );
  const channelByName = new Map<
    string,
    { channelKey: string; componentKey: string }
  >();
  for (const [channelKey, channel] of Object.entries(asyncapi.channels)) {
    const channelMessages = Object.values(channel.messages ?? {});
    if (channelMessages.length !== 1)
      throw new Error(
        `AsyncAPI channel ${channelKey} must map exactly one message`,
      );
    const componentKey = channelMessages[0]?.$ref?.split("/").at(-1);
    if (!componentKey)
      throw new Error(`AsyncAPI channel ${channelKey} has no message ref`);
    const component = asyncapi.components.messages[componentKey];
    if (!component || channel.address !== component.name)
      throw new Error(
        `AsyncAPI channel ${channelKey} address/message mismatch`,
      );
    if (channelByName.has(component.name))
      throw new Error(
        `AsyncAPI message ${component.name} has multiple channels`,
      );
    channelByName.set(component.name, { channelKey, componentKey });
  }
  const operatedChannels = new Set<string>();
  for (const [operationKey, operation] of Object.entries(asyncapi.operations)) {
    if (operation.action !== "send")
      throw new Error(`AsyncAPI operation ${operationKey} must use send`);
    const channelKey = operation.channel?.$ref?.split("/").at(-1);
    if (!channelKey)
      throw new Error(`AsyncAPI operation ${operationKey} has no channel ref`);
    const channel = asyncapi.channels[channelKey];
    const messageRefs = operation.messages ?? [];
    if (!channel || messageRefs.length !== 1)
      throw new Error(
        `AsyncAPI operation ${operationKey} must map one channel/message`,
      );
    const componentKey = messageRefs[0]?.$ref?.split("/").at(-1);
    const channelComponentKey = Object.values(channel.messages ?? {})[0]
      ?.$ref?.split("/")
      .at(-1);
    if (componentKey !== channelComponentKey)
      throw new Error(
        `AsyncAPI operation ${operationKey} message/channel mismatch`,
      );
    if (operatedChannels.has(channelKey))
      throw new Error(`AsyncAPI channel ${channelKey} has multiple operations`);
    operatedChannels.add(channelKey);
  }
  if (operatedChannels.size !== Object.keys(asyncapi.channels).length)
    throw new Error("every AsyncAPI channel must have exactly one operation");

  const catalogOwners = new Map<string, OwnerMetadata>();
  const registerOwners = (
    groups: Record<string, string[]>,
    metadataKey: "issuer" | "recipient" | "producer",
    kind: "command" | "event",
  ): void => {
    for (const [owner, names] of Object.entries(groups))
      for (const name of names) {
        const record: OwnerMetadata = catalogOwners.get(name) ?? { kind };
        if (record.kind !== kind)
          throw new Error(`${name}: catalog kind conflict`);
        record[metadataKey] = owner
          .replace(/([a-z])([A-Z])/g, "$1-$2")
          .toLowerCase();
        catalogOwners.set(name, record);
      }
  };
  registerOwners(
    catalog.integrationMessages.commandsByIssuer,
    "issuer",
    "command",
  );
  registerOwners(
    catalog.integrationMessages.commandsByRecipient,
    "recipient",
    "command",
  );
  registerOwners(
    catalog.integrationMessages.eventsByProducer,
    "producer",
    "event",
  );
  for (const [name, owner] of catalogOwners) {
    const component = componentByName.get(name)?.message;
    if (!component || !channelByName.has(name))
      throw new Error(`${name}: missing AsyncAPI component/channel`);
    if (component["x-message-kind"] !== owner.kind)
      throw new Error(`${name}: AsyncAPI/catalog kind mismatch`);
    if (owner.issuer && component["x-issuer"] !== owner.issuer)
      throw new Error(`${name}: AsyncAPI/catalog issuer mismatch`);
    if (owner.recipient && component["x-recipient"] !== owner.recipient)
      throw new Error(`${name}: AsyncAPI/catalog recipient mismatch`);
    if (owner.producer && component["x-producer"] !== owner.producer)
      throw new Error(`${name}: AsyncAPI/catalog producer mismatch`);
  }
  console.log(
    `contracts: ${operationIds.length} HTTP operations covered by ${httpFixtures} HTTP fixtures, ${catalogMessages.length} mapped messages, ${validPayloads} valid and ${invalidPayloads} invalid input payload fixtures, ${publishedPayloadSubsets} published payload subsets`,
  );
}

async function verifyScenarios(): Promise<void> {
  const shared = parseBoundary<DataObject>(
    await readJson(path.join(schemaRoot, "shared.schema.json")),
    "shared.schema.json",
  );
  const scenarioSchema = parseBoundary<DataObject>(
    await readJson(path.join(root, "acceptance/scenario.schema.json")),
    "scenario.schema.json",
  );
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    strictRequired: false,
    strictTypes: false,
  });
  addFormats(ajv);
  ajv.addSchema(schemaAtBoundary(shared, "shared schema"));
  const validate: ValidateFunction = ajv.compile(
    schemaAtBoundary(scenarioSchema, "scenario schema"),
  );
  const scenarioDir = path.join(root, "acceptance/scenarios");
  const names = (await readdir(scenarioDir))
    .filter((name) => name.endsWith(".json"))
    .sort();
  if (names.length !== 16)
    throw new Error(`expected 16 scenarios, found ${names.length}`);
  for (const name of names) {
    const scenario = parseBoundary<Scenario>(
      await readJson(path.join(scenarioDir, name)),
      name,
    );
    if (!validate(scenario))
      throw new Error(
        `${name}: ${ajv.errorsText(validate.errors, { separator: "\n" })}`,
      );
    const captures = new Set<string>();
    const priorInputs = new Map<number, ScenarioInput>();
    let previousSequence = 0;
    const verifyScenarioReferences = (value: unknown): void => {
      if (typeof value !== "string" || !value.includes("${")) return;
      const match = value.match(scenarioReferencePattern);
      if (!match) throw new Error(`${name}: invalid reference ${value}`);
      if (match[1] && !captures.has(match[1]))
        throw new Error(`${name}: capture ${match[1]} used before definition`);
      if (match[2]) {
        const referencedInput = priorInputs.get(Number(match[2]));
        if (!referencedInput)
          throw new Error(`${name}: input ${match[2]} used before definition`);
        const field = match[3];
        const exists =
          (field === "requestId" &&
            referencedInput.kind === "http" &&
            typeof referencedInput.request?.headers?.["X-Request-Id"] ===
              "string") ||
          ((field === "commandId" || field === "eventId") &&
            referencedInput.kind === "integrationMessage" &&
            typeof referencedInput.body?.[field] === "string");
        if (!exists)
          throw new Error(
            `${name}: input ${match[2]} does not expose supported ${field}`,
          );
      }
    };
    for (const input of scenario.inputs) {
      if (input.sequence <= previousSequence)
        throw new Error(
          `${name}: input sequences must be unique and increasing`,
        );
      previousSequence = input.sequence;
      walkValue(input, verifyScenarioReferences);
      priorInputs.set(input.sequence, input);
      for (const key of Object.keys(
        input.expect?.captures ?? input.await?.captures ?? {},
      ))
        captures.add(key);
    }
    for (const published of scenario.expected.publishedMessages ?? []) {
      for (const key of Object.keys(published.captures ?? {}))
        captures.add(key);
      walkValue(published, verifyScenarioReferences);
    }
    const expectedWithoutPublished = {
      ...scenario.expected,
      publishedMessages: [],
    };
    walkValue(expectedWithoutPublished, verifyScenarioReferences);
    for (const location of [
      scenario.fixtureControls,
      scenario.identities,
      scenario.initialState,
    ])
      walkValue(location, verifyScenarioReferences);
    walkValue(scenario, (value) => {
      if (isObject(value) && Array.isArray(value["acceptanceGates"])) {
        const gates = value["acceptanceGates"].map((gate, index) =>
          parseBoundary<Gate>(gate, `${name}: acceptanceGates[${index}]`),
        );
        const ids = gates.map((gate) => gate.gateId);
        if (new Set(ids).size !== ids.length)
          throw new Error(`${name}: duplicate gateId`);
        const digest = value["gateSetDigest"];
        if (
          isObject(digest) &&
          digest["algorithm"] === "sha256" &&
          typeof digest["value"] === "string" &&
          digest["value"] !== gateSetDigest(gates)
        )
          throw new Error(`${name}: gateSetDigest does not bind its gate set`);
      }
    });
  }
  console.log(
    `scenarios: ${names.length} schemas, strict references, unique increasing sequences, captures, and gate hashes verified`,
  );
}

function anchor(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N} -]/gu, "")
    .replace(/\s+/g, "-");
}

async function markdownFiles(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (
      ["node_modules", "dist", "coverage", ".git", ".patchquest"].includes(
        entry.name,
      )
    )
      continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await markdownFiles(absolute)));
    else if (entry.name.endsWith(".md")) result.push(absolute);
  }
  return result;
}

async function verifyDocs(): Promise<void> {
  const files = await markdownFiles(root);
  let links = 0;
  for (const source of files) {
    const content = await readFile(source, "utf8");
    for (const match of content.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
      const destination = match[1]?.split(/\s+['"]/)[0];
      if (!destination || /^(https?:|mailto:)/.test(destination)) continue;
      const [relative, fragment] = destination.split("#", 2);
      const target = relative
        ? path.resolve(path.dirname(source), decodeURIComponent(relative))
        : source;
      await access(target);
      if (fragment && target.endsWith(".md")) {
        const headings = (await readFile(target, "utf8"))
          .split("\n")
          .filter((line) => /^#{1,6} /.test(line))
          .map((line) => anchor(line.replace(/^#{1,6} /, "")));
        if (!headings.includes(decodeURIComponent(fragment)))
          throw new Error(
            `${source}: missing heading #${fragment} in ${target}`,
          );
      }
      links += 1;
    }
  }
  console.log(`docs: ${links} local links resolve`);
}

async function allFiles(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (
      ["node_modules", "dist", "coverage", ".git", ".patchquest"].includes(
        entry.name,
      )
    )
      continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await allFiles(absolute)));
    else result.push(absolute);
  }
  return result;
}

async function verifyPolicy(): Promise<void> {
  const files = await allFiles(root);
  const lockfiles = files.filter(
    (file: string) => path.basename(file) === "package-lock.json",
  );
  const expectedLock = path.join(nodeRoot, "package-lock.json");
  if (lockfiles.length !== 1 || lockfiles[0] !== expectedLock)
    throw new Error("repository must contain only node/package-lock.json");
  const manifest = objectAtBoundary(
    await readJson(path.join(nodeRoot, "package.json")),
    "package.json",
  );
  const scarfSettings = isObject(manifest["scarfSettings"])
    ? manifest["scarfSettings"]
    : undefined;
  if (scarfSettings?.["enabled"] !== false)
    throw new Error("package.json must explicitly disable Scarf analytics");
  const ignore = await readFile(path.join(root, ".gitignore"), "utf8");
  for (const pattern of [
    "node_modules/",
    "dist/",
    "*.tsbuildinfo",
    "coverage/",
    ".env",
    ".idea/",
    ".vscode/",
  ]) {
    if (!ignore.split("\n").includes(pattern))
      throw new Error(`.gitignore must contain ${pattern}`);
  }
  const generated: string[] = [];
  const inspectGenerated = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (["node_modules", ".git", ".patchquest"].includes(entry.name))
        continue;
      const absolute = path.join(directory, entry.name);
      if (
        entry.name === "dist" ||
        entry.name === "coverage" ||
        entry.name.endsWith(".tsbuildinfo")
      ) {
        generated.push(path.relative(root, absolute));
      } else if (entry.isDirectory()) await inspectGenerated(absolute);
    }
  };
  await inspectGenerated(root);
  if (generated.length > 0)
    throw new Error(
      `generated outputs must be absent after the verification pre-clean: ${generated.join(", ")}`,
    );
  console.log(
    "policy: one lockfile, Scarf analytics disabled, generated outputs ignored and absent",
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  if (mode === "contracts") await verifyContracts();
  else if (mode === "scenarios") await verifyScenarios();
  else if (mode === "docs") await verifyDocs();
  else if (mode === "policy") await verifyPolicy();
  else
    throw new Error(
      "usage: verify-repository.mjs contracts|scenarios|docs|policy",
    );
}
