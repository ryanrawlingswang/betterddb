import { z } from 'zod';
import { BetterDDB } from '../src/betterddb';
import { DynamoDB } from 'aws-sdk';

const TEST_TABLE = 'TestTable';

// LocalStack Configuration
const client = new DynamoDB.DocumentClient({
  region: 'us-east-1',
  endpoint: 'http://localhost:4566'
});

// Table Schema
const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  createdAt: z.string(),
  updatedAt: z.string()
});

const userDal = new BetterDDB({
  schema: UserSchema,
  tableName: TEST_TABLE,
  keys: {
    primary: { name: 'pk', definition: 'id' }
  },
  client,
  autoTimestamps: true
});

beforeAll(async () => {
  const dynamoDB = new DynamoDB({
    region: 'us-east-1',
    endpoint: 'http://localhost:4566'
  });

  console.log('Creating DynamoDB table in LocalStack...');

  await dynamoDB.createTable({
    TableName: TEST_TABLE,
    KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }],
    AttributeDefinitions: [{ AttributeName: 'pk', AttributeType: 'S' }],
    BillingMode: 'PAY_PER_REQUEST'
  }).promise();

  // Wait for the table to become active
  while (true) {
    const { Table } = await dynamoDB.describeTable({ TableName: TEST_TABLE }).promise();
    if (Table?.TableStatus === 'ACTIVE') {
      console.log('DynamoDB table is ready.');
      break;
    }
    console.log('Waiting for table to become ACTIVE...');
    await new Promise(res => setTimeout(res, 1000)); // Wait 1 sec before retrying
  }
});

afterAll(async () => {
  // Cleanup: delete the table
  const dynamoDB = new DynamoDB({
    region: 'us-east-1',
    endpoint: 'http://localhost:4566'
  });

  await dynamoDB.deleteTable({ TableName: TEST_TABLE }).promise();
});

describe('BetterDDB - Integration Tests', () => {
  it('should insert an item into DynamoDB', async () => {
    const user = {
      id: 'user-123',
      name: 'John Doe',
      email: 'john@example.com'
    };

    const createdUser = await userDal.create(user as any);
    expect(createdUser).toHaveProperty('createdAt');
    expect(createdUser).toHaveProperty('updatedAt');
  });

  it('should retrieve an item by ID', async () => {
    const user = await userDal.get({ id: 'user-123' });
    expect(user).not.toBeNull();
    expect(user?.id).toBe('user-123');
  });

  it('should update an existing item', async () => {
    const updatedUser = await userDal.update({ id: 'user-123' }, { name: 'Jane Doe' });
    expect(updatedUser.name).toBe('Jane Doe');
  });

  it('should delete an item', async () => {
    await userDal.delete({ id: 'user-123' });
    const deletedUser = await userDal.get({ id: 'user-123' });
    expect(deletedUser).toBeNull();
  });
});
