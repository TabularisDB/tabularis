/**
 * AWS commercial-region codes, ordered to match the AWS Regions table:
 * https://docs.aws.amazon.com/global-infrastructure/latest/regions/aws-regions.html
 *
 * GovCloud / China partitions are omitted — they require separate account
 * types and hostnames (`amazonaws.com.cn`, `amazonaws-us-gov.com`).
 */
export const AWS_REGION_CODES = [
  "us-east-1",
  "us-east-2",
  "us-west-1",
  "us-west-2",
  "af-south-1",
  "ap-east-1",
  "ap-east-2",
  "ap-south-1",
  "ap-south-2",
  "ap-southeast-1",
  "ap-southeast-2",
  "ap-southeast-3",
  "ap-southeast-4",
  "ap-southeast-5",
  "ap-southeast-6",
  "ap-southeast-7",
  "ap-northeast-1",
  "ap-northeast-2",
  "ap-northeast-3",
  "ca-central-1",
  "ca-west-1",
  "eu-central-1",
  "eu-central-2",
  "eu-west-1",
  "eu-west-2",
  "eu-west-3",
  "eu-south-1",
  "eu-south-2",
  "eu-north-1",
  "il-central-1",
  "mx-central-1",
  "me-south-1",
  "me-central-1",
  "sa-east-1",
] as const;

export type AwsRegionCode = (typeof AWS_REGION_CODES)[number];

/** Human-readable names keyed by region code. */
export const AWS_REGION_LABELS: Record<AwsRegionCode, string> = {
  "us-east-1": "US East (N. Virginia)",
  "us-east-2": "US East (Ohio)",
  "us-west-1": "US West (N. California)",
  "us-west-2": "US West (Oregon)",
  "af-south-1": "Africa (Cape Town)",
  "ap-east-1": "Asia Pacific (Hong Kong)",
  "ap-east-2": "Asia Pacific (Taipei)",
  "ap-south-1": "Asia Pacific (Mumbai)",
  "ap-south-2": "Asia Pacific (Hyderabad)",
  "ap-southeast-1": "Asia Pacific (Singapore)",
  "ap-southeast-2": "Asia Pacific (Sydney)",
  "ap-southeast-3": "Asia Pacific (Jakarta)",
  "ap-southeast-4": "Asia Pacific (Melbourne)",
  "ap-southeast-5": "Asia Pacific (Malaysia)",
  "ap-southeast-6": "Asia Pacific (New Zealand)",
  "ap-southeast-7": "Asia Pacific (Thailand)",
  "ap-northeast-1": "Asia Pacific (Tokyo)",
  "ap-northeast-2": "Asia Pacific (Seoul)",
  "ap-northeast-3": "Asia Pacific (Osaka)",
  "ca-central-1": "Canada (Central)",
  "ca-west-1": "Canada West (Calgary)",
  "eu-central-1": "Europe (Frankfurt)",
  "eu-central-2": "Europe (Zurich)",
  "eu-west-1": "Europe (Ireland)",
  "eu-west-2": "Europe (London)",
  "eu-west-3": "Europe (Paris)",
  "eu-south-1": "Europe (Milan)",
  "eu-south-2": "Europe (Spain)",
  "eu-north-1": "Europe (Stockholm)",
  "il-central-1": "Israel (Tel Aviv)",
  "mx-central-1": "Mexico (Central)",
  "me-south-1": "Middle East (Bahrain)",
  "me-central-1": "Middle East (UAE)",
  "sa-east-1": "South America (São Paulo)",
};

/** Labels suitable for the shared `<Select>` component (`code — Name`). */
export const AWS_REGION_SELECT_LABELS: Record<string, string> = Object.fromEntries(
  AWS_REGION_CODES.map((code) => [
    code,
    `${code} — ${AWS_REGION_LABELS[code]}`,
  ]),
);

/**
 * Extract a region code from a standard DynamoDB endpoint hostname,
 * e.g. `dynamodb.us-west-2.amazonaws.com` → `us-west-2`.
 */
export function regionFromDynamoDbHost(host: string | undefined | null): string | null {
  if (!host) return null;
  const bare = host
    .trim()
    .replace(/^https?:\/\//i, "")
    .split(/[/:]/)[0]
    ?.toLowerCase();
  if (!bare) return null;
  const match = /^dynamodb\.([a-z0-9-]+)\.amazonaws\.com$/.exec(bare);
  return match?.[1] ?? null;
}
