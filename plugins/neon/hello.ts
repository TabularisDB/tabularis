export default async function hello(): Promise<Response> {
  return new Response("Hello from Neon Functions");
}
