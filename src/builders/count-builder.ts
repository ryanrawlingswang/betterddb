import { BetterDDB } from '../betterddb';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { GetItemInput } from '@aws-sdk/client-dynamodb';
export class CountBuilder<T> {
  constructor(private parent: BetterDDB<T>) {}

  public async execute(): Promise<number> {
    if (this.parent.getCounter()) {
      throw new Error("Counter is not enabled");
    }
    const params: GetItemInput = {
      TableName: this.parent.getTableName(),
      Key: {
        pk: {S: `ENTITYTYPE#${this.parent.getEntityType()}`},
        sk: {S: "COUNT"}
      }
    };
    const result = await this.parent.getClient().send(new GetCommand(params));
    if (!result.Item) return 0;
    return result.Item.count;
  }
}
