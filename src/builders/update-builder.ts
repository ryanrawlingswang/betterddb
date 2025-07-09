import {
  type NativeAttributeValue,
  TransactWriteCommand,
  UpdateCommand,
  type UpdateCommandInput,
} from "@aws-sdk/lib-dynamodb";
import { type BetterDDB } from "../betterddb.js";
import {
  type TransactWriteItem,
  type Update,
  type ReturnValue,
} from "@aws-sdk/client-dynamodb";

interface UpdateActions<T> {
  set?: Partial<T>;
  remove?: (keyof T)[];
  add?: Partial<Record<keyof T, number | Set<NativeAttributeValue>>>;
  delete?: Partial<Record<keyof T, Set<NativeAttributeValue>>>;
}

export class UpdateBuilder<T> {
  private actions: UpdateActions<T> = {};
  private condition?: {
    expression: string;
    attributeValues: Record<string, NativeAttributeValue>;
    attributeNames: Record<string, string>;
  };
  // When using transaction mode, we store extra transaction items.
  private extraTransactItems: TransactWriteItem[] = [];

  // Reference to the parent BetterDDB instance and key.
  constructor(
    private parent: BetterDDB<T>,
    private key: Partial<T>,
  ) {}

  // Chainable methods:
  public set(attrs: Partial<T>): this {
    // Separate values into sets and removes
    const { toSet, toRemove } = Object.entries(attrs).reduce(
      (acc, [key, value]) => {
        if (
          value === undefined ||
          (typeof value === "string" &&
            value.trim() === "" &&
            this.parent.getSchema().shape[key]?.isOptional?.())
        ) {
          acc.toRemove.push(key as keyof T);
        } else {
          acc.toSet[key] = value;
        }
        return acc;
      },
      { toSet: {} as Record<string, any>, toRemove: [] as (keyof T)[] },
    );

    // Handle non-empty values with set
    if (Object.keys(toSet).length > 0) {
      const partialSchema = this.parent.getSchema().partial();
      const validated = partialSchema.parse(toSet);
      this.actions.set = { ...this.actions.set, ...validated };
    }

    // Handle empty/undefined values with remove
    if (toRemove.length > 0) {
      this.remove(toRemove);
    }

    return this;
  }

  public remove(attrs: (keyof T)[]): this {
    this.actions.remove = [...(this.actions.remove ?? []), ...attrs];
    return this;
  }

  public add(
    attrs: Partial<Record<keyof T, number | Set<NativeAttributeValue>>>,
  ): this {
    const partialSchema = this.parent.getSchema().partial();
    const validated = partialSchema.parse(attrs);
    this.actions.add = { ...this.actions.add, ...validated };

    return this;
  }

  public delete(
    attrs: Partial<Record<keyof T, Set<NativeAttributeValue>>>,
  ): this {
    this.actions.delete = { ...this.actions.delete, ...attrs };
    return this;
  }

  /**
   * Adds a condition expression to the update.
   */
  public setCondition(
    expression: string,
    attributeValues: Record<string, NativeAttributeValue>,
    attributeNames: Record<string, string>,
  ): this {
    if (this.condition) {
      // Merge conditions with AND.
      this.condition.expression += ` AND ${expression}`;
      Object.assign(this.condition.attributeValues, attributeValues);
      Object.assign(this.condition.attributeNames, attributeNames);
    } else {
      this.condition = {
        expression,
        attributeValues,
        attributeNames,
      };
    }
    return this;
  }

  /**
   * Specifies additional transaction items to include when executing this update as a transaction.
   */
  public transactWrite(ops: TransactWriteItem[] | TransactWriteItem): this {
    if (Array.isArray(ops)) {
      this.extraTransactItems.push(...ops);
    } else {
      this.extraTransactItems.push(ops);
    }
    return this;
  }

  /**
   * Builds the update expression and associated maps.
   */
  private buildExpression(newItemForIndexes?: T): {
    updateExpression: string;
    attributeNames: Record<string, string>;
    attributeValues?: Record<string, NativeAttributeValue>;
  } {
    const ExpressionAttributeNames: Record<string, string> = {};
    const ExpressionAttributeValues: Record<string, NativeAttributeValue> = {};
    const clauses: string[] = [];

    // 1) SET – from actions.set
    const setParts: string[] = [];
    if (this.actions.set) {
      for (const [attr, value] of Object.entries(this.actions.set)) {
        const nameKey = `#n_${attr}`;
        const valueKey = `:v_${attr}`;
        ExpressionAttributeNames[nameKey] = attr;
        ExpressionAttributeValues[valueKey] = value!;
        setParts.push(`${nameKey} = ${valueKey}`);
      }
    }

    // 2) also SET – from index‐rebuild if requested
    if (newItemForIndexes) {
      const indexAttrs = this.parent.buildIndexes(newItemForIndexes);
      for (const [attr, value] of Object.entries(indexAttrs)) {
        const nameKey = `#n_idx_${attr}`;
        const valueKey = `:v_idx_${attr}`;
        ExpressionAttributeNames[nameKey] = attr;
        ExpressionAttributeValues[valueKey] = value;
        setParts.push(`${nameKey} = ${valueKey}`);
      }
    }
    if (setParts.length > 0) {
      clauses.push(`SET ${setParts.join(", ")}`);
    }

    // 3) REMOVE
    if (this.actions.remove?.length) {
      const removeParts = this.actions.remove.map((attr) => {
        const nameKey = `#n_${String(attr)}`;
        ExpressionAttributeNames[nameKey] = String(attr);
        return nameKey;
      });
      clauses.push(`REMOVE ${removeParts.join(", ")}`);
    }

    // 4) ADD
    if (this.actions.add) {
      const addParts: string[] = [];
      for (const [attr, value] of Object.entries(this.actions.add)) {
        const nameKey = `#n_${attr}`;
        const valueKey = `:v_${attr}`;
        ExpressionAttributeNames[nameKey] = attr;
        ExpressionAttributeValues[valueKey] = value as NativeAttributeValue;
        addParts.push(`${nameKey} ${valueKey}`);
      }
      if (addParts.length) {
        clauses.push(`ADD ${addParts.join(", ")}`);
      }
    }

    // 5) DELETE
    if (this.actions.delete) {
      const deleteParts: string[] = [];
      for (const [attr, value] of Object.entries(this.actions.delete)) {
        const nameKey = `#n_${attr}`;
        const valueKey = `:v_${attr}`;
        ExpressionAttributeNames[nameKey] = attr;
        ExpressionAttributeValues[valueKey] = value as NativeAttributeValue;
        deleteParts.push(`${nameKey} ${valueKey}`);
      }
      if (deleteParts.length) {
        clauses.push(`DELETE ${deleteParts.join(", ")}`);
      }
    }

    // 6) merge in condition‐names/values
    if (this.condition) {
      Object.assign(ExpressionAttributeNames, this.condition.attributeNames);
      Object.assign(ExpressionAttributeValues, this.condition.attributeValues);
    }

    // 7) normalize empty values
    const hasValues = Object.keys(ExpressionAttributeValues).length > 0;
    const finalValues = hasValues ? ExpressionAttributeValues : undefined;

    if (clauses.length === 0) {
      throw new Error(
        "No attributes to update – all values were empty or undefined",
      );
    }

    return {
      updateExpression: clauses.join(" "),
      attributeNames: ExpressionAttributeNames,
      attributeValues: finalValues,
    };
  }

  /**
   * Returns a transaction update item that can be included in a transactWrite call.
   */
  public async toTransactUpdate(
    newItemForIndexes?: T,
  ): Promise<TransactWriteItem> {
    if (!newItemForIndexes) {
      newItemForIndexes = await this.createExpectedNewItem();
    }
    const { updateExpression, attributeNames, attributeValues } =
      this.buildExpression(newItemForIndexes);
    const updateItem: Update = {
      TableName: this.parent.getTableName(),
      Key: this.parent.buildKey(this.key),
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: attributeNames,
      ExpressionAttributeValues: attributeValues,
    };
    if (this.condition?.expression) {
      updateItem.ConditionExpression = this.condition.expression;
    }
    return { Update: updateItem };
  }

  private async createExpectedNewItem() {
    const existingItem = await this.parent.get(this.key).execute();
    if (existingItem === null) {
      throw new Error("Item not found");
    }
    const expectedNewItem: Record<string, any> = {
      ...existingItem,
      ...this.actions.set,
    };
    if (this.actions.remove) {
      this.actions.remove.forEach((attr) => {
        delete expectedNewItem[String(attr)];
      });
    }
    if (this.actions.add) {
      Object.entries(this.actions.add).forEach(([attr, value]) => {
        const currentValue = expectedNewItem[attr] ?? 0;
        if (typeof value === "number") {
          expectedNewItem[attr] = currentValue + value;
        } else if (value instanceof Set) {
          const currentSet =
            expectedNewItem[attr] instanceof Set
              ? expectedNewItem[attr]
              : new Set();
          expectedNewItem[attr] = new Set([...currentSet, ...value]);
        }
      });
    }
    if (this.actions.delete) {
      Object.entries(this.actions.delete).forEach(([attr, value]) => {
        if (value instanceof Set) {
          const currentSet = expectedNewItem[attr];
          if (currentSet instanceof Set) {
            value.forEach((v) => {
              currentSet.delete(v);
            });
          }
        }
      });
    }
    return this.parent.getSchema().parse(expectedNewItem) as T;
  }

  /**
   * Commits the update immediately by calling the parent's update method.
   */
  public async execute(): Promise<T> {
    const expectedNewItem = await this.createExpectedNewItem();

    if (this.parent.getTimestamps()) {
      const now = new Date().toISOString();
      if (!this.actions.set) {
        this.actions.set = {};
      }
      this.actions.set = { ...this.actions.set, updatedAt: now };
    }
    if (this.extraTransactItems.length > 0) {
      // For transactions, we must throw if there's nothing to update
      // since we can't safely skip updates in a transaction
      const myTransactItem = await this.toTransactUpdate(expectedNewItem);
      const allItems = [...this.extraTransactItems, myTransactItem];
      await this.parent.getClient().send(
        new TransactWriteCommand({
          TransactItems: allItems,
        }),
      );
      // After transaction, retrieve the updated item.
      const result = await this.parent.get(this.key).execute();
      if (result === null) {
        throw new Error("Item not found after transaction update");
      }

      return result;
    }

    // For normal updates, handle empty updates gracefully
    try {
      const { updateExpression, attributeNames, attributeValues } =
        this.buildExpression(expectedNewItem);

      let params: UpdateCommandInput = {
        TableName: this.parent.getTableName(),
        Key: this.parent.buildKey(this.key),
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: attributeNames,
        ExpressionAttributeValues: attributeValues,
        ReturnValues: "ALL_NEW" as ReturnValue,
      };

      if (this.condition?.expression) {
        params.ConditionExpression = this.condition.expression;
      }
      const result = await this.parent
        .getClient()
        .send(new UpdateCommand(params));
      if (!result.Attributes) {
        throw new Error("No attributes returned after update");
      }
      return this.parent.getSchema().parse(result.Attributes) as T;
    } catch (error) {
      // If there's nothing to update, just return the existing item
      if (
        error instanceof Error &&
        error.message ===
          "No attributes to update - all values were empty or undefined"
      ) {
        const existingItem = await this.parent.get(this.key).execute();
        if (existingItem === null) {
          throw new Error("Item not found");
        }
        return existingItem;
      }
      throw error;
    }
  }
}
