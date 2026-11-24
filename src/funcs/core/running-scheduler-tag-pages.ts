/**
 * Collect every EC2 instance ARN from `tag:GetResources`.
 *
 * One response holds at most 100 resources. Reading stops only when {@link isLastGetResourcesPage} is true.
 */
import {
  GetResourcesCommand,
  type GetResourcesCommandOutput,
  type ResourceGroupsTaggingAPIClient,
} from '@aws-sdk/client-resource-groups-tagging-api';
import { isLastGetResourcesPage } from './running-scheduler-predicates';

/** Instance ARNs from every page of one tag lookup. */
export interface CollectedTaggedInstances {
  /** Instance ARNs in page order. Mappings without `ResourceARN` are omitted. */
  readonly arns: readonly string[];
  /** Number of `GetResources` responses read. */
  readonly pageCount: number;
}

/**
 * Reads `tag:GetResources` until `PaginationToken` is absent or empty.
 *
 * @param client - Tagging API client. The caller owns retries and timeouts.
 * @param tagKey - Tag key from the scheduler payload.
 * @param tagValues - Tag values from the scheduler payload.
 * @returns Instance ARNs and how many pages were read. Both are empty of ARNs when nothing matches.
 */
export const collectTaggedInstanceArns = async (
  client: ResourceGroupsTaggingAPIClient,
  tagKey: string,
  tagValues: readonly string[],
): Promise<CollectedTaggedInstances> => {
  const arns: string[] = [];
  let paginationToken: string | undefined = undefined;
  let pageCount = 0;
  do {
    const page: GetResourcesCommandOutput = await client.send(new GetResourcesCommand({
      ResourceTypeFilters: ['ec2:instance'],
      TagFilters: [{ Key: tagKey, Values: [...tagValues] }],
      PaginationToken: paginationToken,
    }));
    pageCount += 1;
    const pageArns = (page.ResourceTagMappingList ?? [])
      .map((mapping) => mapping.ResourceARN)
      .filter((arn): arn is string => arn != null);
    arns.push(...pageArns);
    paginationToken = page.PaginationToken;
  } while (!isLastGetResourcesPage(paginationToken));
  return { arns, pageCount };
};
