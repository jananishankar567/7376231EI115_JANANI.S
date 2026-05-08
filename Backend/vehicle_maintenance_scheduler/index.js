const DEFAULT_EVALUATION_SERVICE_BASE = process.env.EVALUATION_SERVICE_BASE_URL || 'http://4.224.186.213/evaluation-service';
const DEPOTS_API_URL = process.env.DEPOTS_API_URL || `${DEFAULT_EVALUATION_SERVICE_BASE}/depots`;
const DEPOT_TASKS_API_URL_TEMPLATE = process.env.DEPOT_TASKS_API_URL_TEMPLATE || `${DEFAULT_EVALUATION_SERVICE_BASE}/depots/{depotId}/tasks`;

const fetchJson = async (url, options = {}) => {
  if (typeof fetch !== 'function') {
    throw new Error('Global fetch is unavailable in this Node runtime. Use Node 18+ or install a fetch polyfill.');
  }

  const response = await fetch(url, options);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Fetch failed ${response.status} ${response.statusText}: ${text}`);
  }

  return response.json();
};

const sampleDepots = [
  { id: 'depot-1', name: 'Central Depot', location: 'London', description: 'Primary logistics hub.' },
  { id: 'depot-2', name: 'North Depot', location: 'Manchester', description: 'Regional service center.' },
];

const sampleTasks = [
  { id: 'task-101', vehicleId: 'V-1001', description: 'Brake system inspection', durationHours: 1.5, importanceScore: 35 },
  { id: 'task-102', vehicleId: 'V-1004', description: 'Engine diagnostics', durationHours: 3.0, importanceScore: 65 },
  { id: 'task-103', vehicleId: 'V-1007', description: 'Tire replacement', durationHours: 2.0, importanceScore: 45 },
  { id: 'task-104', vehicleId: 'V-1012', description: 'Oil and filter change', durationHours: 1.0, importanceScore: 20 },
  { id: 'task-105', vehicleId: 'V-1019', description: 'Hydraulic system repair', durationHours: 4.0, importanceScore: 80 },
];

const buildDepotTasksUrl = (depotId) => DEPOT_TASKS_API_URL_TEMPLATE.replace('{depotId}', encodeURIComponent(depotId));

const getDepots = async (logFunction) => {
  if (logFunction) {
    await logFunction('request', 'debug', 'vehicle-scheduler', 'Fetching depots from external API');
  }
  return fetchJson(DEPOTS_API_URL);
};

const getDepotTasks = async (depotId, logFunction) => {
  if (!depotId) {
    throw new Error('depotId is required to fetch tasks.');
  }

  if (logFunction) {
    await logFunction('request', 'debug', 'vehicle-scheduler', `Fetching tasks for depot: ${depotId}`);
  }

  return fetchJson(buildDepotTasksUrl(depotId));
};

const normalizeTask = (task) => {
  const durationHours = Number(task.durationHours ?? task.estimatedHours ?? task.timeHours ?? 0);
  const importanceScore = Number(task.importanceScore ?? task.score ?? task.priority ?? 0);
  const durationMinutes = Math.round(durationHours * 60);

  return {
    ...task,
    durationHours,
    importanceScore,
    durationMinutes,
  };
};

const scheduleTasksByBudget = (tasks, budgetHours, logFunction) => {
  if (!Array.isArray(tasks)) {
    throw new Error('Tasks must be an array.');
  }
  if (typeof budgetHours !== 'number' || Number.isNaN(budgetHours) || budgetHours <= 0) {
    throw new Error('budgetHours must be a positive number.');
  }

  const capacityMinutes = Math.round(budgetHours * 60);
  const normalizedTasks = tasks
    .map(normalizeTask)
    .filter((task) => task.durationMinutes > 0 && task.importanceScore > 0);

  if (normalizedTasks.length === 0) {
    if (logFunction) {
      logFunction('warn', 'warn', 'vehicle-scheduler', 'No valid tasks found for scheduling');
    }
    return {
      selectedTasks: [],
      totalDurationHours: 0,
      totalScore: 0,
      usedMinutes: 0,
      capacityMinutes,
    };
  }

  const n = normalizedTasks.length;
  const dp = new Array(capacityMinutes + 1).fill(0);
  const pick = Array.from({ length: n }, () => new Array(capacityMinutes + 1).fill(false));

  for (let i = 0; i < n; i += 1) {
    const { durationMinutes, importanceScore } = normalizedTasks[i];
    for (let w = capacityMinutes; w >= durationMinutes; w -= 1) {
      const candidate = dp[w - durationMinutes] + importanceScore;
      if (candidate > dp[w]) {
        dp[w] = candidate;
        pick[i][w] = true;
      }
    }
  }

  let remaining = capacityMinutes;
  const selected = [];

  for (let i = n - 1; i >= 0; i -= 1) {
    if (pick[i][remaining]) {
      selected.push(normalizedTasks[i]);
      remaining -= normalizedTasks[i].durationMinutes;
    }
  }

  const totalDurationMinutes = selected.reduce((sum, item) => sum + item.durationMinutes, 0);
  const totalScore = selected.reduce((sum, item) => sum + item.importanceScore, 0);

  if (logFunction) {
    logFunction('info', 'info', 'vehicle-scheduler', `Schedule calculated: ${selected.length} tasks, score: ${totalScore}`);
  }

  return {
    selectedTasks: selected.reverse(),
    totalDurationHours: totalDurationMinutes / 60,
    totalScore,
    usedMinutes: totalDurationMinutes,
    capacityMinutes,
  };
};

const buildScheduleResponse = ({ selectedTasks, totalDurationHours, totalScore, usedMinutes, capacityMinutes }, budgetHours) => ({
  budgetHours,
  capacityMinutes,
  usedMinutes,
  totalDurationHours,
  totalScore,
  selectedCount: selectedTasks.length,
  selectedTasks: selectedTasks.map((task) => ({
    id: task.id,
    vehicleId: task.vehicleId ?? task.vehicle_id ?? task.vehicle,
    description: task.description ?? task.summary ?? 'Maintenance task',
    durationHours: task.durationHours,
    importanceScore: task.importanceScore,
  })),
});

module.exports = {
  getDepots,
  getDepotTasks,
  scheduleTasksByBudget,
  buildScheduleResponse,
  sampleDepots,
  sampleTasks,
};
