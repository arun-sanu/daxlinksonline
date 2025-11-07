import { inject, computed } from 'https://unpkg.com/vue@3/dist/vue.esm-browser.prod.js';
import WorkflowDesigner from '../components/WorkflowDesigner.js';

export default {
  name: 'WorkflowPage',
  components: { WorkflowDesigner },
  setup() {
    const store = inject('dashboardStore');
    const actions = inject('dashboardActions');
    const loading = computed(() => store.loading);
    const selectedNode = computed(() => store.dataflowNodes.find((node) => node.id === store.selectedNodeId) || null);
    return { store, actions, loading, selectedNode };
  },
  template: `
    <main class="layout-container section-pad">
      <div v-if="loading" class="flex h-64 items-center justify-center text-sm muted-text">
        Loading workflow designer...
      </div>
      <WorkflowDesigner
        v-else
        :dataflow-nodes="store.dataflowNodes"
        :selected-node-id="store.selectedNodeId"
        :selected-node="selectedNode"
        :workflow-summary="store.workflowSummary"
        :format-metric-label="actions.formatMetricLabel"
        @select-node="actions.selectNode"
      />
    </main>
  `
};
