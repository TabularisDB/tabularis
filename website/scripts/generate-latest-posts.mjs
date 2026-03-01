import fs from "fs";
import path from "path";
import matter from "gray-matter";

const BASE_URL = "https://tabularis.dev";
const POSTS_DIR = path.join(process.cwd(), "content", "posts");
const OUT_DIR = path.join(process.cwd(), "out");

const files = fs.readdirSync(POSTS_DIR).filter((f) => f.endsWith(".md"));

const posts = files.map((file) => {
  const slug = file.replace(/\.md$/, "");
  const raw = fs.readFileSync(path.join(POSTS_DIR, file), "utf-8");
  const { data } = matter(raw);
  return {
    slug,
    title: data.title ?? "",
    date: data.date ?? "",
  };
});

posts.sort((a, b) => {
  const d = b.date.localeCompare(a.date);
  return d !== 0 ? d : a.slug.localeCompare(b.slug);
});

const latest = posts.slice(0, 5).map((p) => ({
  title: p.title,
  date: p.date,
  url: `${BASE_URL}/blog/${p.slug}`,
  image: `${BASE_URL}/blog/${p.slug}/opengraph-image`,
}));

fs.writeFileSync(
  path.join(OUT_DIR, "latest-posts.json"),
  JSON.stringify(latest, null, 2) + "\n",
);

console.log("Generated latest-posts.json with %d posts", latest.length);
