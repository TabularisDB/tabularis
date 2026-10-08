import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

async function updateRoadmap() {
  try {
    console.log('Fetching roadmap issues from GitHub...');
    // Fetch all issues with label "roadmap"
    // We fetch title, state, url, and number
    const output = execSync('gh issue list --label roadmap --state all --json title,state,url,number', { encoding: 'utf-8' });
    const issues = JSON.parse(output);

    console.log(`Found ${issues.length} roadmap items from GitHub.`);

    // Map GitHub issues to roadmap format
    const githubItems = issues.map(issue => ({
      label: issue.title,
      done: issue.state === 'CLOSED',
      url: issue.url
    }));

    // Sort GitHub items: closed first, then open
    githubItems.sort((a, b) => {
      if (a.done === b.done) return 0;
      return a.done ? -1 : 1;
    });

    // Path to roadmap.json
    const roadmapPath = path.join(process.cwd(), 'roadmap.json');
    fs.writeFileSync(roadmapPath, JSON.stringify(githubItems, null, 2) + '\n');
    console.log(`Successfully updated roadmap.json with ${githubItems.length} items.`);

    // Update README.md
    const readmePath = path.join(process.cwd(), 'README.md');
    let readme = fs.readFileSync(readmePath, 'utf-8');

    const roadmapMarkdown = githubItems
      .map(item => `- [${item.done ? 'x' : ' '}] [${item.label}](${item.url})`)
      .join('\n');

    // Replace roadmap section in README
    // Look for ## Roadmap followed by the list and then the next section
    readme = readme.replace(
      /(## Roadmap\n\n)([\s\S]*?)(\n## \w)/,
      `$1${roadmapMarkdown}\n$3`
    );

    fs.writeFileSync(readmePath, readme);
    console.log('✅ Updated README.md roadmap');

  } catch (error) {
    console.error('Error updating roadmap:', error.message);
    process.exit(1);
  }
}

updateRoadmap();
