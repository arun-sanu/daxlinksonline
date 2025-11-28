import { initExecuteOrdersQueue } from './queue.js';
import { executePreparedSignal } from './executeOrder.js';

initExecuteOrdersQueue({
  processor: async (job) => {
    const { signalId } = job.data || {};
    return executePreparedSignal(signalId);
  }
});
