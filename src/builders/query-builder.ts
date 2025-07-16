/* eslint-disable no-unused-vars */
import {
  type NativeAttributeValue,
  QueryCommand,
  type QueryCommandInput,
} from "@aws-sdk/lib-dynamodb";
import { type BetterDDB, type GSIConfig } from "../betterddb.js";
import { getOperatorExpression, Operator } from "../operator.js";
import { type PaginatedResult } from "../types/paginated-result.js";

export class QueryBuilder<T> {
  private keyConditions: string[] = [];
  private filterConditions: string[] = [];
  private expressionAttributeNames: Record<string, string> = {};
  private expressionAttributeValues: Record<string, NativeAttributeValue>;
  private index?: GSIConfig<T>;
  private limit?: number;
  private lastKey?: Record<string, NativeAttributeValue>;
  private ascending = true;

  constructor(
    private parent: BetterDDB<T>,
    private key: Partial<T>,
  ) {
    const keys = this.parent.getKeys();
    const pkName = keys.primary.name;
    const builtKey = this.parent.buildKey(this.key);

    this.expressionAttributeNames = {
      "#pk": pkName,
    };
    this.expressionAttributeValues = {
      ":pk_value": builtKey[pkName] as Record<string, NativeAttributeValue>,
    };
  }

  public usingIndex(indexName: string): this {
    if (!this.parent.getKeys().gsis) {
      throw new Error("No global secondary indexes defined for this table");
    }
    if (!(indexName in this.parent.getKeys().gsis!)) {
      throw new Error("index does not exist");
    }

    this.index = this.parent.getKeys().gsis![indexName];

    if (!this.index) {
      throw new Error("Failed to get index configuration");
    }

    const pkName = this.index.primary.name;
    const builtKey = this.parent.buildIndexes(this.key);
    this.expressionAttributeNames["#pk"] = pkName;
    this.expressionAttributeValues[":pk_value"] = builtKey[pkName] as Record<
      string,
      NativeAttributeValue
    >;

    return this;
  }

  public sortAscending(): this {
    this.ascending = true;
    return this;
  }

  public sortDescending(): this {
    this.ascending = false;
    return this;
  }

  public where(
    operator: Operator,
    values: Partial<T> | [Partial<T>, Partial<T>],
  ): this {
    const keys = this.parent.getKeys();
    // Determine the sort key name from either the index or the primary keys.
    const sortKeyName = this.index ? this.index.sort?.name : keys.sort?.name;
    if (!sortKeyName) {
      throw new Error("Sort key is not defined for this table/index.");
    }
    const nameKey = "#sk";
    this.expressionAttributeNames[nameKey] = sortKeyName;

    // Enforce that a complex sort key requires an object input.
    if (typeof values !== "object" || values === null) {
      throw new Error(
        `For complex sort keys, please provide an object with all necessary properties.`,
      );
    }

    if (operator === Operator.BETWEEN) {
      if (!Array.isArray(values) || values.length !== 2) {
        throw new Error(
          `For 'between' operator, values must be a tuple of two objects`,
        );
      }
      const valueKeyStart = ":sk_start";
      const valueKeyEnd = ":sk_end";
      // Use the key definition's build function to build the key from the full object.
      this.expressionAttributeValues[valueKeyStart] = this.index
        ? (this.parent.buildIndexes(values[0])[sortKeyName] as Record<
            string,
            NativeAttributeValue
          >)
        : (this.parent.buildKey(values[0])[sortKeyName] as Record<
            string,
            NativeAttributeValue
          >);
      this.expressionAttributeValues[valueKeyEnd] = this.index
        ? (this.parent.buildIndexes(values[1])[sortKeyName] as Record<
            string,
            NativeAttributeValue
          >)
        : (this.parent.buildKey(values[1])[sortKeyName] as Record<
            string,
            NativeAttributeValue
          >);
      this.keyConditions.push(
        `${nameKey} BETWEEN ${valueKeyStart} AND ${valueKeyEnd}`,
      );
    } else if (operator === Operator.BEGINS_WITH) {
      const valueKey = ":sk_value";
      this.expressionAttributeValues[valueKey] = this.index
        ? (this.parent.buildIndexes(values as Partial<T>)[
            sortKeyName
          ] as Record<string, NativeAttributeValue>)
        : (this.parent.buildKey(values as Partial<T>)[sortKeyName] as Record<
            string,
            NativeAttributeValue
          >);
      this.keyConditions.push(`begins_with(${nameKey}, ${valueKey})`);
    } else {
      // For eq, lt, lte, gt, gte:
      const valueKey = ":sk_value";
      this.expressionAttributeValues[valueKey] = this.index
        ? (this.parent.buildIndexes(values as Partial<T>)[
            sortKeyName
          ] as Record<string, NativeAttributeValue>)
        : (this.parent.buildKey(values as Partial<T>)[sortKeyName] as Record<
            string,
            NativeAttributeValue
          >);
      const condition = getOperatorExpression(operator, nameKey, valueKey);
      this.keyConditions.push(condition);
    }
    return this;
  }

  public filter(attribute: keyof T, operator: Operator, values: unknown): this {
    const attrStr = String(attribute);
    const randomString = Math.random().toString(36).substring(2, 15);
    const placeholderName = `#attr_${attrStr}_${randomString}`;
    this.expressionAttributeNames[placeholderName] = attrStr;
    if (operator === Operator.BETWEEN) {
      if (!Array.isArray(values) || values.length !== 2) {
        throw new Error(
          "For 'between' operator, values must be a tuple of two items",
        );
      }
      const placeholderValueStart = `:val_start_${attrStr}_${randomString}`;
      const placeholderValueEnd = `:val_end_${attrStr}_${randomString}`;
      this.expressionAttributeValues[placeholderValueStart] =
        values[0] as Record<string, NativeAttributeValue>;
      this.expressionAttributeValues[placeholderValueEnd] = values[1] as Record<
        string,
        NativeAttributeValue
      >;
      this.filterConditions.push(
        `${placeholderName} BETWEEN ${placeholderValueStart} AND ${placeholderValueEnd}`,
      );
    } else if (
      operator === Operator.BEGINS_WITH ||
      operator === Operator.CONTAINS
    ) {
      const placeholderValue = `:val_${attrStr}_${randomString}`;
      this.expressionAttributeValues[placeholderValue] = values as Record<
        string,
        NativeAttributeValue
      >;
      this.filterConditions.push(
        `${operator}(${placeholderName}, ${placeholderValue})`,
      );
    } else {
      const placeholderValue = `:val_${attrStr}_${randomString}`;
      this.expressionAttributeValues[placeholderValue] = values as Record<
        string,
        NativeAttributeValue
      >;
      const condition = getOperatorExpression(
        operator,
        placeholderName,
        placeholderValue,
      );
      this.filterConditions.push(condition);
    }

    return this;
  }

  public limitResults(limit: number): this {
    this.limit = limit;
    return this;
  }

  public startFrom(lastKey: Record<string, NativeAttributeValue>): this {
    this.lastKey = lastKey;
    return this;
  }

  /**
   * Executes the query and returns a Promise that resolves with an array of items.
   */
  public async execute(): Promise<PaginatedResult<T>> {
    this.keyConditions.unshift(`#pk = :pk_value`);
    const keyConditionExpression = this.keyConditions.join(" AND ");

    const params: QueryCommandInput = {
      TableName: this.parent.getTableName(),
      KeyConditionExpression: keyConditionExpression,
      ExpressionAttributeNames: this.expressionAttributeNames,
      ExpressionAttributeValues: this.expressionAttributeValues,
      ScanIndexForward: this.ascending,
      Limit: this.limit,
      ExclusiveStartKey: this.lastKey,
      IndexName: this.index?.name ?? undefined,
    };

    if (this.parent.getEntityType()) {
      this.filterConditions.push(`#entity = :entity_value`);
      this.expressionAttributeNames["#entity"] = "entityType";
      this.expressionAttributeValues[":entity_value"] =
        this.parent.getEntityType();
    }
    params.FilterExpression =
      this.filterConditions.length > 0
        ? this.filterConditions.join(" AND ")
        : undefined;

    const result = await this.parent.getClient().send(new QueryCommand(params));
    return {
      items: this.parent.getSchema().array().parse(result.Items) as T[],
      lastKey: result.LastEvaluatedKey ?? undefined,
    };
  }
}
