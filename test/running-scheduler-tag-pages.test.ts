import { GetResourcesCommand, ResourceGroupsTaggingAPIClient } from '@aws-sdk/client-resource-groups-tagging-api';
import { mockClient } from 'aws-sdk-client-mock';
import 'aws-sdk-client-mock-jest';
import { collectTaggedInstanceArns } from '../src/funcs/core/running-scheduler-tag-pages';

const taggingMock = mockClient(ResourceGroupsTaggingAPIClient);
const client = new ResourceGroupsTaggingAPIClient({});
const TAG_KEY = 'Schedule';
const TAG_VALUES = ['YES'];
const FIRST_ARN = 'arn:aws:ec2:ap-northeast-1:123456789012:instance/i-page1';
const SECOND_ARN = 'arn:aws:ec2:ap-northeast-1:123456789012:instance/i-page2';
const THIRD_ARN = 'arn:aws:ec2:ap-northeast-1:123456789012:instance/i-page3';

describe('collectTaggedInstanceArns', () => {
  beforeEach(() => {
    taggingMock.reset();
  });

  it('returns instance ARNs from one page and skips a mapping without an ARN', async () => {
    taggingMock.on(GetResourcesCommand).resolves({
      ResourceTagMappingList: [
        { ResourceARN: FIRST_ARN },
        { ResourceARN: undefined },
      ],
    });

    const collected = await collectTaggedInstanceArns(client, TAG_KEY, TAG_VALUES);

    expect(collected).toEqual({ arns: [FIRST_ARN], pageCount: 1 });
    expect(taggingMock).toHaveReceivedCommandTimes(GetResourcesCommand, 1);
    expect(taggingMock).toHaveReceivedCommandWith(GetResourcesCommand, {
      ResourceTypeFilters: ['ec2:instance'],
      TagFilters: [{ Key: TAG_KEY, Values: TAG_VALUES }],
      PaginationToken: undefined,
    });
  });

  it('reads every page until the pagination token is absent', async () => {
    taggingMock.on(GetResourcesCommand)
      .resolvesOnce({
        PaginationToken: 'page-2',
        ResourceTagMappingList: [{ ResourceARN: FIRST_ARN }],
      })
      .resolvesOnce({
        PaginationToken: 'page-3',
        ResourceTagMappingList: [{ ResourceARN: SECOND_ARN }],
      })
      .resolves({
        ResourceTagMappingList: [{ ResourceARN: THIRD_ARN }],
      });

    const collected = await collectTaggedInstanceArns(client, TAG_KEY, TAG_VALUES);

    expect(collected).toEqual({
      arns: [FIRST_ARN, SECOND_ARN, THIRD_ARN],
      pageCount: 3,
    });
    expect(taggingMock).toHaveReceivedCommandTimes(GetResourcesCommand, 3);
    expect(taggingMock).toHaveReceivedNthCommandWith(2, GetResourcesCommand, { PaginationToken: 'page-2' });
    expect(taggingMock).toHaveReceivedNthCommandWith(3, GetResourcesCommand, { PaginationToken: 'page-3' });
  });

  it('returns no ARNs when the only page omits the mapping list', async () => {
    taggingMock.on(GetResourcesCommand).resolves({});

    const collected = await collectTaggedInstanceArns(client, TAG_KEY, TAG_VALUES);

    expect(collected).toEqual({ arns: [], pageCount: 1 });
    expect(taggingMock).toHaveReceivedCommandTimes(GetResourcesCommand, 1);
  });
});
