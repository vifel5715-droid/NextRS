import { getErrorStatus } from './errorMessage';

export const sleep = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms));

export const fetchWithRetry = async <T>(fn: () => Promise<T>, maxRetries = 5): Promise<T> => {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error: unknown) {
      const status = getErrorStatus(error);

      if (status === 429 && i < maxRetries - 1) {
        await sleep(Math.pow(2, i + 1) * 1000);
        continue;
      }

      if ((status === 500 || status === 502 || status === 503 || status === 504) && i < 2) {
        await sleep((i + 1) * 2000);
        continue;
      }

      if (status === 429) throw new Error('Server is busy. Please try again in a few moments.');
      if (status === 500) throw new Error('Server encountered an internal error. Please try again.');
      if (status === 502 || status === 503 || status === 504) throw new Error('Server is temporarily unavailable. Please try again later.');
      if (status === 401) throw new Error('Your session has expired. Please log in again.');
      if (status === 403) throw new Error('You do not have permission to access this resource.');
      if (status === 404) throw new Error('The requested resource was not found.');
      throw error;
    }
  }
  throw new Error('Unable to connect to the server. Please check your connection and try again.');
};

export const fetchWithSimpleRetry = async <T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> => {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error: unknown) {
      if (getErrorStatus(error) === 429 && i < maxRetries - 1) {
        await sleep(Math.pow(2, i) * 1000);
      } else {
        throw error;
      }
    }
  }
  throw new Error('Max retries exceeded');
};
