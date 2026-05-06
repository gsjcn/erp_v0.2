const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || '/api';

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    ...options
  });

  if (!response.ok) {
    const message = await response.text();
    try {
      const parsed = JSON.parse(message) as { message?: string | string[]; error?: string };
      const parsedMessage = Array.isArray(parsed.message) ? parsed.message.join('; ') : parsed.message || parsed.error;
      throw new Error(parsedMessage || `Request failed: ${response.status}`);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(message || `Request failed: ${response.status}`);
      }
      throw error;
    }
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}
