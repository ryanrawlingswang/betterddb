import {
  type NativeAttributeValue,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { type BetterDDB } from "../betterddb.js";
import {
  type TransactWriteItem,
  type Update,
  type UpdateItemInput,
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
          (typeof value === "string" && value.trim() === "")
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
  private buildExpression(): {
    updateExpression: string;
    attributeNames: Record<string, string>;
    attributeValues?: Record<string, NativeAttributeValue>;
  } {
    const ExpressionAttributeNames: Record<string, string> = {};
    let ExpressionAttributeValues:
      | Record<string, NativeAttributeValue>
      | undefined = {};
    const clauses: string[] = [];

    // Build SET clause.
    if (this.actions.set) {
      const setParts: string[] = [];
      for (const [attr, value] of Object.entries(this.actions.set)) {
        const nameKey = `#n_${attr}`;
        const valueKey = `:v_${attr}`;
        ExpressionAttributeNames[nameKey] = attr;
        ExpressionAttributeValues[valueKey] = value;
        setParts.push(`${nameKey} = ${valueKey}`);
      }
      if (setParts.length > 0) {
        clauses.push(`SET ${setParts.join(", ")}`);
      }
    }

    // Build REMOVE clause.
    if (this.actions.remove && this.actions.remove.length > 0) {
      const removeParts = this.actions.remove.map((attr) => {
        const nameKey = `#n_${String(attr)}`;
        ExpressionAttributeNames[nameKey] = String(attr);
        return nameKey;
      });
      clauses.push(`REMOVE ${removeParts.join(", ")}`);
    }

    // Build ADD clause.
    if (this.actions.add) {
      const addParts: string[] = [];
      for (const [attr, value] of Object.entries(this.actions.add)) {
        const nameKey = `#n_${attr}`;
        const valueKey = `:v_${attr}`;
        ExpressionAttributeNames[nameKey] = attr;
        ExpressionAttributeValues[valueKey] = value;
        addParts.push(`${nameKey} ${valueKey}`);
      }
      if (addParts.length > 0) {
        clauses.push(`ADD ${addParts.join(", ")}`);
      }
    }

    // Build DELETE clause.
    if (this.actions.delete) {
      const deleteParts: string[] = [];
      for (const [attr, value] of Object.entries(this.actions.delete)) {
        const nameKey = `#n_${attr}`;
        const valueKey = `:v_${attr}`;
        ExpressionAttributeNames[nameKey] = attr;
        ExpressionAttributeValues[valueKey] = value;
        deleteParts.push(`${nameKey} ${valueKey}`);
      }
      if (deleteParts.length > 0) {
        clauses.push(`DELETE ${deleteParts.join(", ")}`);
      }
    }

    // Merge any provided condition attribute names and values
    if (this.condition) {
      Object.assign(ExpressionAttributeNames, this.condition.attributeNames);
      Object.assign(ExpressionAttributeValues, this.condition.attributeValues);
    }

    if (Object.keys(ExpressionAttributeValues).length === 0) {
      ExpressionAttributeValues = undefined;
    }

    // If no clauses were generated, throw an error
    if (clauses.length === 0) {
      throw new Error(
        "No attributes to update - all values were empty or undefined",
      );
    }

    return {
      updateExpression: clauses.join(" "),
      attributeNames: ExpressionAttributeNames,
      attributeValues: ExpressionAttributeValues,
    };
  }

  /**
   * Returns a transaction update item that can be included in a transactWrite call.
   */
  public toTransactUpdate(): TransactWriteItem {
    const { updateExpression, attributeNames, attributeValues } =
      this.buildExpression();
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

  private async rebuildIndexes() {
    const existingItem = await this.parent.get(this.key).execute();
    if (existingItem === null) {
      throw new Error("Item not found");
    }
    const indexAttributes = this.parent.buildIndexes(existingItem);
    if (Object.keys(indexAttributes).length > 0) {
      const updateExpression = `SET ${Object.entries(indexAttributes)
        .map(([attr]) => `#n_${attr} = :v_${attr}`)
        .join(", ")}`;
      const attributeNames = Object.fromEntries(
        Object.entries(indexAttributes).map(([attr]) => [`#n_${attr}`, attr]),
      );
      const attributeValues = Object.fromEntries(
        Object.entries(indexAttributes).map(([attr, value]) => [
          `:v_${attr}`,
          value,
        ]),
      );

      const params: UpdateItemInput = {
        TableName: this.parent.getTableName(),
        Key: this.parent.buildKey(this.key),
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: attributeNames,
        ExpressionAttributeValues: attributeValues,
        ReturnValues: "ALL_NEW",
      };

      const result = await this.parent
        .getClient()
        .send(new UpdateCommand(params));
      return result.Attributes;
    }
    return existingItem;
  }

  /**
   * Commits the update immediately by calling the parent's update method.
   */
  public async execute(): Promise<T> {
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
      const myTransactItem = this.toTransactUpdate();
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
      const rebuiltItem = await this.rebuildIndexes();
      return this.parent.getSchema().parse(rebuiltItem) as T;
    }

    // For normal updates, handle empty updates gracefully
    try {
      const { updateExpression, attributeNames, attributeValues } =
        this.buildExpression();
      const params: UpdateItemInput = {
        TableName: this.parent.getTableName(),
        Key: this.parent.buildKey(this.key),
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: attributeNames,
        ExpressionAttributeValues: attributeValues,
        ReturnValues: "ALL_NEW",
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

      const rebuiltItem = await this.rebuildIndexes();
      return this.parent.getSchema().parse(rebuiltItem) as T;
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
