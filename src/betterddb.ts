import { type z } from "zod";
import { QueryBuilder } from "./builders/query-builder.js";
import { ScanBuilder } from "./builders/scan-builder.js";
import { UpdateBuilder } from "./builders/update-builder.js";
import { CreateBuilder } from "./builders/create-builder.js";
import { GetBuilder } from "./builders/get-builder.js";
import { DeleteBuilder } from "./builders/delete-builder.js";
import {
  type NativeAttributeValue,
  type DynamoDBDocumentClient,
} from "@aws-sdk/lib-dynamodb";
import { BatchGetBuilder } from "./builders/batch-get-builder.js";
export type PrimaryKeyValue = string | number;

/**
 * A key definition can be either a simple key (a property name)
 * or an object containing a build function that computes the value.
 * (In this design, the attribute name is provided separately.)
 */
export type KeyDefinition<T> =
  | keyof T
  | {
      // eslint-disable-next-line no-unused-vars
      build: (rawKey: Partial<T>) => string;
    };

/**
 * Configuration for a primary (partition) key.
 */
export interface PrimaryKeyConfig<T> {
  /** The attribute name for the primary key in DynamoDB */
  name: string;
  /** How to compute the key value; if a keyof T, then the raw value is used;
   * if an object, the build function is used.
   */
  definition: KeyDefinition<T>;
}

/**
 * Configuration for a sort key.
 */
export interface SortKeyConfig<T> {
  /** The attribute name for the sort key in DynamoDB */
  name: string;
  /** How to compute the sort key value */
  definition: KeyDefinition<T>;
}

/**
 * Configuration for a Global Secondary Index (GSI).
 */
export interface GSIConfig<T> {
  /** The name of the GSI in DynamoDB */
  name: string;
  /** The primary key configuration for the GSI */
  primary: PrimaryKeyConfig<T>;
  /** The sort key configuration for the GSI, if any */
  sort?: SortKeyConfig<T>;
}

/**
 * Keys configuration for the table.
 */
export interface KeysConfig<T> {
  primary: PrimaryKeyConfig<T>;
  sort?: SortKeyConfig<T>;
  gsis?: Record<string, GSIConfig<T>>;
}

/**
 * Options for initializing BetterDDB.
 */
export interface BetterDDBOptions<T> {
  schema: z.AnyZodObject;
  tableName: string;
  entityType?: string;
  keys: KeysConfig<T>;
  client: DynamoDBDocumentClient;
  counter?: boolean;
  /**
   * If true, automatically inject timestamp fields:
   * - On create, sets both `createdAt` and `updatedAt`
   * - On update, sets `updatedAt`
   *
   * (T should include these fields if enabled.)
   */
  timestamps?: boolean;
}

/**
 * BetterDDB is a definition-based DynamoDB wrapper library.
 */
export class BetterDDB<T> {
  protected schema: z.AnyZodObject;
  protected tableName: string;
  protected entityType?: string;
  protected client: DynamoDBDocumentClient;
  protected keys: KeysConfig<T>;
  protected timestamps: boolean;
  protected counter: boolean;

  constructor(options: BetterDDBOptions<T>) {
    this.schema = options.schema;
    this.tableName = options.tableName;
    this.entityType = options.entityType?.toUpperCase();
    this.keys = options.keys;
    this.client = options.client;
    this.timestamps = options.timestamps ?? false;
    this.counter = options.counter ?? false;
  }

  public getCounter(): boolean {
    return this.counter;
  }

  public getKeys(): KeysConfig<T> {
    return this.keys;
  }

  public getTableName(): string {
    return this.tableName;
  }

  public getClient(): DynamoDBDocumentClient {
    return this.client;
  }

  public getSchema(): z.AnyZodObject {
    return this.schema;
  }

  public getTimestamps(): boolean {
    return this.timestamps;
  }

  public getEntityType(): string | undefined {
    return this.entityType;
  }

  // Helper: Retrieve the key value from a KeyDefinition.
  protected getKeyValue(def: KeyDefinition<T>, rawKey: Partial<T>): string {
    if (
      typeof def === "string" ||
      typeof def === "number" ||
      typeof def === "symbol"
    ) {
      return String(rawKey[def]);
    } else {
      return def.build(rawKey);
    }
  }

  /**
   * Build the primary key from a raw key object.
   */
  public buildKey(rawKey: Partial<T>): Record<string, NativeAttributeValue> {
    const keyObj: Record<string, NativeAttributeValue> = {};

    // For primary (partition) key:
    const pkConfig = this.keys.primary;
    keyObj[pkConfig.name] =
      typeof pkConfig.definition === "string" ||
      typeof pkConfig.definition === "number" ||
      typeof pkConfig.definition === "symbol"
        ? String(rawKey[pkConfig.definition])
        : pkConfig.definition.build(rawKey);

    // For sort key, if defined:
    if (this.keys.sort) {
      const skConfig = this.keys.sort;
      keyObj[skConfig.name] =
        typeof skConfig.definition === "string" ||
        typeof skConfig.definition === "number" ||
        typeof skConfig.definition === "symbol"
          ? String(rawKey[skConfig.definition])
          : skConfig.definition.build(rawKey);
    }
    return keyObj;
  }

  /**
   * Build index attributes for each defined GSI.
   */
  public buildIndexes(
    rawItem: Partial<T>,
  ): Record<string, NativeAttributeValue> {
    const indexAttributes: Record<string, NativeAttributeValue> = {};
    if (this.keys.gsis) {
      for (const gsiName in this.keys.gsis) {
        const gsiConfig = this.keys.gsis[gsiName];
        if (!gsiConfig) continue;

        // Compute primary index attribute.
        const primaryConfig = gsiConfig.primary;
        indexAttributes[primaryConfig.name] =
          typeof primaryConfig.definition === "string" ||
          typeof primaryConfig.definition === "number" ||
          typeof primaryConfig.definition === "symbol"
            ? String(rawItem[primaryConfig.definition])
            : primaryConfig.definition.build(rawItem);

        // Compute sort index attribute if provided.
        if (gsiConfig?.sort) {
          const sortConfig = gsiConfig.sort;
          indexAttributes[sortConfig.name] =
            typeof sortConfig.definition === "string" ||
            typeof sortConfig.definition === "number" ||
            typeof sortConfig.definition === "symbol"
              ? String(rawItem[sortConfig.definition])
              : sortConfig.definition.build(rawItem);
        }
      }
    }
    return indexAttributes;
  }

  /**
   * Create an item:
   * - Computes primary key and index attributes,
   * - Optionally injects timestamps,
   * - Validates the item and writes it to DynamoDB.
   */
  public create(item: T): CreateBuilder<T> {
    return new CreateBuilder<T>(this, item);
  }

  /**
   * Get an item by its primary key.
   */
  public get(rawKey: Partial<T>): GetBuilder<T> {
    return new GetBuilder<T>(this, rawKey);
  }

  /**
   * Get multiple items by their primary keys.
   */
  public batchGet(rawKeys: Partial<T>[]): BatchGetBuilder<T> {
    return new BatchGetBuilder<T>(this, rawKeys);
  }

  /**
   * Update an item.
   */
  public update(key: Partial<T>): UpdateBuilder<T> {
    return new UpdateBuilder<T>(this, key);
  }

  /**
   * Delete an item.
   */
  public delete(rawKey: Partial<T>): DeleteBuilder<T> {
    return new DeleteBuilder<T>(this, rawKey);
  }

  /**
   * Query items.
   */
  public query(key: Partial<T>): QueryBuilder<T> {
    return new QueryBuilder<T>(this, key);
  }

  /**
   * Scan for items.
   */
  public scan(): ScanBuilder<T> {
    return new ScanBuilder<T>(this);
  }
}
