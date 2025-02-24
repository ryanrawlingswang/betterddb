import {
  AttributeValue,
  Put,
  TransactWriteItem,
} from "@aws-sdk/client-dynamodb";
import { BetterDDB } from "../betterddb";
import { PutCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";

export class CreateBuilder<T> {
  private extraTransactItems: TransactWriteItem[] = [];

  constructor(
    private parent: BetterDDB<T>,
    private item: T,
  ) {}

  public async execute(): Promise<T> {
    const validated = this.parent.getSchema().parse(this.item);
    if (this.extraTransactItems.length > 0) {
      // Build our update transaction item.
      const myTransactItem = this.toTransactPut();
      // Combine with extra transaction items.
      const allItems = [...this.extraTransactItems, myTransactItem];
      await this.parent.getClient().send(
        new TransactWriteCommand({
          TransactItems: allItems,
        }),
      );
      // After transaction, retrieve the updated item.
      const result = await this.parent.get(this.item).execute();
      if (result === null) {
        throw new Error("Item not found after transaction create");
      }
      return result;
    } else {
      let finalItem: T = {
        ...this.item,
        entityType: this.parent.getEntityType(),
      };
      if (this.parent.getTimestamps()) {
        const now = new Date().toISOString();
        finalItem = { ...finalItem, createdAt: now, updatedAt: now } as T;
      }

      // Compute and merge primary key.
      const computedKeys = this.parent.buildKey(validated as Partial<T>);
      finalItem = { ...finalItem, ...computedKeys };

      // Compute and merge index attributes.
      const indexAttributes = this.parent.buildIndexes(validated as Partial<T>);
      finalItem = { ...finalItem, ...indexAttributes };

      await this.parent.getClient().send(
        new PutCommand({
          TableName: this.parent.getTableName(),
          Item: finalItem as Record<string, AttributeValue>,
        }),
      );

      return validated as T;
    }
  }

  public transactWrite(ops: TransactWriteItem[] | TransactWriteItem): this {
    if (Array.isArray(ops)) {
      this.extraTransactItems.push(...ops);
    } else {
      this.extraTransactItems.push(ops);
    }
    return this;
  }

  public toTransactPut(): TransactWriteItem {
    const validated = this.parent.getSchema().parse(this.item);
    let finalItem: T = {
      ...this.item,
      entityType: this.parent.getEntityType(),
    };
    if (this.parent.getTimestamps()) {
      const now = new Date().toISOString();
      finalItem = { ...finalItem, createdAt: now, updatedAt: now } as T;
    }

    // Compute and merge primary key.
    const computedKeys = this.parent.buildKey(validated as Partial<T>);
    finalItem = { ...finalItem, ...computedKeys };

    // Compute and merge index attributes.
    const indexAttributes = this.parent.buildIndexes(validated as Partial<T>);
    finalItem = { ...finalItem, ...indexAttributes };
    const putItem: Put = {
      TableName: this.parent.getTableName(),
      Item: finalItem as Record<string, AttributeValue>,
    };
    return { Put: putItem };
  }
}
