import type { RequestTab } from '@/types';

/**
 * item_requests and service_requests each have their own id sequence, so an
 * item request and a service request can share the same numeric id. Caches
 * keyed only by id must namespace by type to avoid collisions.
 */
export const makeRequestKey = (type: RequestTab, id: number): string => `${type}-${id}`;
