import { useEffect } from 'react';
import { useRequestManagement } from './useRequestManagement';

export const useCustodianRequests = () => {
  const management = useRequestManagement({ supervisorApprovedOnly: true });
  const { loadItemRequests, loadServiceRequests } = management;

  // Both lists load together on mount, not just whichever tab is active —
  // the dashboard shows both tabs' badge counts at once (see
  // CustodianDashboard.tsx's matchingItemRequests/matchingServiceRequests),
  // so loading only the active tab left the other badge stuck at 0 until
  // the user actually clicked over to it. Matches useSupervisorRequests.ts's
  // fetch-both-up-front pattern.
  useEffect(() => {
    void loadItemRequests();
    void loadServiceRequests();
  }, [loadItemRequests, loadServiceRequests]);

  return management;
};
