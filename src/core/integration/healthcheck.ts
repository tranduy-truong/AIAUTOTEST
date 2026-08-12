import net from 'net';

export interface HealthcheckResult {
  ok: boolean;
  durationMs: number;
  statusCode?: number;
  error?: string;
}

export async function pollHttpHealthcheck(
  url: string,
  timeoutMs = 30000,
  intervalMs = 500,
): Promise<HealthcheckResult> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url, { method: 'GET' });
      if (response.ok || response.status < 500) {
        return {
          ok: true,
          durationMs: Date.now() - start,
          statusCode: response.status,
        };
      }
    } catch {
      // Server not ready yet, continue polling
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }

  return {
    ok: false,
    durationMs: Date.now() - start,
    error: `Healthcheck HTTP tới ${url} quá thời hạn (${timeoutMs}ms) mà server chưa sẵn sàng.`,
  };
}

export async function pollTcpHealthcheck(
  host: string,
  port: number,
  timeoutMs = 15000,
  intervalMs = 300,
): Promise<HealthcheckResult> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const isReady = await new Promise<boolean>(resolve => {
      const socket = new net.Socket();
      socket.setTimeout(1000);
      socket.on('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.on('error', () => {
        socket.destroy();
        resolve(false);
      });
      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });
      socket.connect(port, host);
    });

    if (isReady) {
      return { ok: true, durationMs: Date.now() - start };
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }

  return {
    ok: false,
    durationMs: Date.now() - start,
    error: `TCP Connection tới ${host}:${port} quá thời hạn (${timeoutMs}ms).`,
  };
}
