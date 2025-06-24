import { z } from "zod";
import { BetterDDB } from "../src/betterddb";
import { createTestTable, deleteTestTable } from "./utils/table-setup";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { DynamoDB, GlobalSecondaryIndex } from "@aws-sdk/client-dynamodb";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import {
  KeySchemaElement,
  AttributeDefinition,
} from "@aws-sdk/client-dynamodb";
const TEST_TABLE = "create-test-table";
const ENDPOINT = "http://localhost:4566";
const REGION = "us-east-1";
const ENTITY_TYPE = "USER";
const PRIMARY_KEY = "pk";
const PRIMARY_KEY_TYPE = "S";
const SORT_KEY = "sk";
const SORT_KEY_TYPE = "S";
const GSI_NAME = "EmailIndex";
const GSI_PRIMARY_KEY = "gsi1pk";
const GSI_SORT_KEY = "gsi1sk";
const KEY_SCHEMA = [
  { AttributeName: PRIMARY_KEY, KeyType: "HASH" },
  { AttributeName: SORT_KEY, KeyType: "RANGE" },
] as KeySchemaElement[];
const ATTRIBUTE_DEFINITIONS = [
  { AttributeName: PRIMARY_KEY, AttributeType: PRIMARY_KEY_TYPE },
  { AttributeName: SORT_KEY, AttributeType: SORT_KEY_TYPE },
  { AttributeName: GSI_PRIMARY_KEY, AttributeType: PRIMARY_KEY_TYPE },
  { AttributeName: GSI_SORT_KEY, AttributeType: SORT_KEY_TYPE },
] as AttributeDefinition[];
const GSIS = [
  {
    IndexName: GSI_NAME,
    KeySchema: [
      { AttributeName: GSI_PRIMARY_KEY, KeyType: "HASH" },
      { AttributeName: GSI_SORT_KEY, KeyType: "RANGE" },
    ],
    Projection: {
      ProjectionType: "ALL",
    },
  },
] as GlobalSecondaryIndex[];
const client = DynamoDBDocumentClient.from(
  new DynamoDB({
    region: REGION,
    endpoint: ENDPOINT,
  }),
);

const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
});

type User = z.infer<typeof UserSchema>;

const userDdb = new BetterDDB<User>({
  schema: UserSchema,
  tableName: TEST_TABLE,
  entityType: ENTITY_TYPE,
  keys: {
    primary: { name: "pk", definition: { build: (raw) => `USER#${raw.id}` } },
    sort: { name: "sk", definition: { build: (raw) => `EMAIL#${raw.email}` } },
    gsis: {
      gsi1: {
        name: "gsi1",
        primary: { name: "gsi1pk", definition: { build: (raw) => "NAME" } },
        sort: {
          name: "gsi1sk",
          definition: { build: (raw) => `NAME#${raw.name}` },
        },
      },
    },
  },
  client,
  timestamps: true,
});

beforeAll(async () => {
  await createTestTable(TEST_TABLE, KEY_SCHEMA, ATTRIBUTE_DEFINITIONS, GSIS);
});

afterAll(async () => {
  await deleteTestTable(TEST_TABLE);
});

describe("BetterDDB - Create Operation", () => {
  it("should insert an item using CreateBuilder", async () => {
    const user = {
      id: "user-123",
      name: "John Doe",
      email: "john@example.com",
    };

    await userDdb.create(user).execute();

    const result = await client.send(
      new GetCommand({
        TableName: TEST_TABLE,
        Key: { pk: "USER#user-123", sk: "EMAIL#john@example.com" },
      }),
    );

    expect(result).not.toBeNull();
    expect(result.Item).not.toBeNull();
    expect(result.Item?.pk).toBe("USER#user-123");
    expect(result.Item?.sk).toBe("EMAIL#john@example.com");
    expect(result.Item?.gsi1pk).toBe("NAME");
    expect(result.Item?.gsi1sk).toBe("NAME#John Doe");
    expect(result.Item?.id).toBe("user-123");
    expect(result.Item?.createdAt).not.toBeNull();
    expect(result.Item?.updatedAt).not.toBeNull();
  });

  it("should fails to validate and not insert an item", async () => {
    const user = { id: "user-123", email: "john@example.com" } as User;
    await expect(userDdb.create(user).execute()).rejects.toThrow();
  });
});
