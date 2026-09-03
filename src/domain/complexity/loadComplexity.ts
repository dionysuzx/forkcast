import { parseComplexityAssessment } from './parseAssessment';
import { type ComplexitySnapshot, type EipComplexity } from './complexity';

const GITHUB_DIRECTORY_URL =
  'https://api.github.com/repos/ethsteel/pm/contents/complexity_assessments/EIPs';
const RAW_CONTENT_BASE =
  'https://raw.githubusercontent.com/ethsteel/pm/main/complexity_assessments/EIPs';

const ASSESSMENT_BATCH_SIZE = 5;

interface GitHubFileEntry {
  readonly name: string;
}

let cachedSnapshot: ComplexitySnapshot | null = null;
let inflightLoad: Promise<ComplexitySnapshot> | null = null;

export function getCachedComplexitySnapshot(): ComplexitySnapshot | null {
  return cachedSnapshot;
}

export function loadComplexitySnapshot(): Promise<ComplexitySnapshot> {
  if (cachedSnapshot) return Promise.resolve(cachedSnapshot);
  if (inflightLoad) return inflightLoad;

  inflightLoad = fetchComplexitySnapshot()
    .then((snapshot) => {
      cachedSnapshot = snapshot;
      return snapshot;
    })
    .finally(() => {
      inflightLoad = null;
    });

  return inflightLoad;
}

export function invalidateComplexitySnapshot(): void {
  cachedSnapshot = null;
}

async function fetchComplexitySnapshot(): Promise<ComplexitySnapshot> {
  const availableEipNumbers = await fetchAvailableEipNumbers();
  const byEipNumber = await fetchAssessments(availableEipNumbers);
  return { availableEipNumbers, byEipNumber };
}

async function fetchAvailableEipNumbers(): Promise<readonly number[]> {
  const response = await fetch(GITHUB_DIRECTORY_URL);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch complexity assessments directory: ${response.status}`
    );
  }

  const files: GitHubFileEntry[] = await response.json();
  return files.flatMap((file) => {
    const match = file.name.match(/^EIP-(\d+)\.md$/);
    return match ? [parseInt(match[1], 10)] : [];
  });
}

async function fetchAssessments(
  eipNumbers: readonly number[]
): Promise<ReadonlyMap<number, EipComplexity>> {
  const byEipNumber = new Map<number, EipComplexity>();

  for (let i = 0; i < eipNumbers.length; i += ASSESSMENT_BATCH_SIZE) {
    const batch = eipNumbers.slice(i, i + ASSESSMENT_BATCH_SIZE);
    await Promise.all(
      batch.map(async (eipNumber) => {
        const complexity = await fetchAssessment(eipNumber);
        if (complexity) byEipNumber.set(eipNumber, complexity);
      })
    );
  }

  return byEipNumber;
}

async function fetchAssessment(eipNumber: number): Promise<EipComplexity | null> {
  try {
    const response = await fetch(`${RAW_CONTENT_BASE}/EIP-${eipNumber}.md`);
    if (!response.ok) {
      console.warn(`Failed to fetch EIP-${eipNumber}: ${response.status}`);
      return null;
    }
    return parseComplexityAssessment(await response.text(), eipNumber);
  } catch (err) {
    console.warn(`Error parsing EIP-${eipNumber}:`, err);
    return null;
  }
}
