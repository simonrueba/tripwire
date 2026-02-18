// When an agent reads this file through Tripwire, it will automatically
// receive the "no-hardcoded-secrets" context before seeing the code.

const API_KEY = process.env.API_KEY;

export function callApi(endpoint: string): Promise<Response> {
  return fetch(endpoint, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
}
