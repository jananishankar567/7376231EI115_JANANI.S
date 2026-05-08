require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { getDepots, getDepotTasks, scheduleTasksByBudget, buildScheduleResponse, sampleDepots, sampleTasks } = require('./vehicle_maintenance_scheduler');
const { createLoggingMiddleware, errorLoggingMiddleware, Log } = require('./logging_middleware');
const { sendNotification, getNotification, getNotificationHistory, retryNotification } = require('./notification_app_be');

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(cors());
app.use(express.json());
app.use(createLoggingMiddleware());
app.use(errorLoggingMiddleware());

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Vehicle Maintenance Scheduler service is running' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', uptimeSeconds: process.uptime() });
});

app.get('/depots', async (req, res, next) => {
  try {
    await Log('request', 'info', 'vehicle-scheduler', 'GET /depots - Fetching depot list');
    const depots = await getDepots(Log);
    await Log('response', 'info', 'vehicle-scheduler', `GET /depots - Success: ${depots.length} depots retrieved`);
    res.json({ source: 'external', depots });
  } catch (error) {
    await Log('error', 'warn', 'vehicle-scheduler', `GET /depots - Fallback to sample data. Error: ${error.message}`);
    res.status(502).json({
      warning: 'Unable to fetch depots from external API. Returning sample data instead.',
      error: error.message,
      depots: sampleDepots,
    });
  }
});

app.get('/depots/:depotId/tasks', async (req, res, next) => {
  const { depotId } = req.params;
  try {
    await Log('request', 'info', 'vehicle-scheduler', `GET /depots/${depotId}/tasks - Fetching tasks`);
    const tasks = await getDepotTasks(depotId, Log);
    await Log('response', 'info', 'vehicle-scheduler', `GET /depots/${depotId}/tasks - Success: ${tasks.length} tasks retrieved`);
    res.json({ source: 'external', depotId, tasks });
  } catch (error) {
    await Log('error', 'warn', 'vehicle-scheduler', `GET /depots/${depotId}/tasks - Fallback to sample data. Error: ${error.message}`);
    res.status(502).json({
      warning: 'Unable to fetch tasks from external API. Returning sample data instead.',
      error: error.message,
      depotId,
      tasks: sampleTasks,
    });
  }
});

app.post('/schedule', async (req, res, next) => {
  try {
    const { depotId, budgetHours, tasks } = req.body;
    const budget = Number(budgetHours);

    await Log('request', 'info', 'vehicle-scheduler', `POST /schedule - DepotId: ${depotId}, Budget: ${budget}h`);

    if (!budget || budget <= 0) {
      await Log('error', 'warn', 'vehicle-scheduler', 'POST /schedule - Invalid budget hours');
      return res.status(400).json({ error: 'budgetHours is required and must be a positive number.' });
    }

    let taskList = tasks;
    if (!Array.isArray(taskList) || taskList.length === 0) {
      if (!depotId) {
        await Log('error', 'warn', 'vehicle-scheduler', 'POST /schedule - Missing depotId and tasks');
        return res.status(400).json({ error: 'Either tasks or depotId must be provided.' });
      }
      taskList = await getDepotTasks(depotId, Log);
    }

    const schedule = scheduleTasksByBudget(taskList, budget, Log);
    const response = buildScheduleResponse(schedule, budget);

    await Log('response', 'info', 'vehicle-scheduler', `POST /schedule - Schedule created: ${schedule.selectedTasks.length} tasks selected, score: ${schedule.totalScore}`);

    // Send notification
    if (depotId) {
      sendNotification({
        type: 'schedule_created',
        depotId,
        recipient: 'admin@logistics.com',
        channel: 'email',
        content: `Schedule created for depot ${depotId} with ${schedule.selectedTasks.length} tasks`,
      }, Log).catch(err => Log('error', 'error', 'notification-service', `Failed to send notification: ${err.message}`));
    }

    res.json(response);
  } catch (error) {
    next(error);
  }
});

app.get('/schedule', async (req, res, next) => {
  try {
    const budget = Number(req.query.budgetHours);
    const depotId = req.query.depotId;

    await Log('request', 'info', 'vehicle-scheduler', `GET /schedule - DepotId: ${depotId}, Budget: ${budget}h`);

    if (!budget || budget <= 0) {
      await Log('error', 'warn', 'vehicle-scheduler', 'GET /schedule - Invalid budget hours');
      return res.status(400).json({ error: 'Query parameter budgetHours is required and must be a positive number.' });
    }

    if (!depotId) {
      await Log('error', 'warn', 'vehicle-scheduler', 'GET /schedule - Missing depotId');
      return res.status(400).json({ error: 'Query parameter depotId is required when using GET /schedule.' });
    }

    const taskList = await getDepotTasks(depotId, Log);
    const schedule = scheduleTasksByBudget(taskList, budget, Log);
    await Log('response', 'info', 'vehicle-scheduler', `GET /schedule - Schedule retrieved: ${schedule.selectedTasks.length} tasks`);
    res.json(buildScheduleResponse(schedule, budget));
  } catch (error) {
    next(error);
  }
});

app.post('/api/notifications/send', async (req, res, next) => {
  try {
    const { type, depotId, recipient, channel, content } = req.body;

    await Log('request', 'info', 'notification-service', `POST /api/notifications/send - Type: ${type}, Channel: ${channel}`);

    if (!type || !depotId || !recipient || !channel) {
      await Log('error', 'warn', 'notification-service', 'POST /api/notifications/send - Missing required fields');
      return res.status(400).json({ error: 'Missing required notification fields: type, depotId, recipient, channel' });
    }

    const notification = await sendNotification({ type, depotId, recipient, channel, content }, Log);
    await Log('response', 'info', 'notification-service', `Notification sent: ${notification.id}`);
    res.status(201).json(notification);
  } catch (error) {
    next(error);
  }
});

app.get('/api/notifications/:id', (req, res) => {
  const { id } = req.params;
  const notification = getNotification(id);

  if (!notification) {
    return res.status(404).json({ error: `Notification ${id} not found` });
  }

  res.json(notification);
});

app.get('/api/notifications/history/:depotId', (req, res) => {
  const { depotId } = req.params;
  const history = getNotificationHistory(depotId);
  res.json({ depotId, notifications: history, count: history.length });
});

app.put('/api/notifications/:id/retry', async (req, res, next) => {
  try {
    const { id } = req.params;
    await Log('request', 'info', 'notification-service', `PUT /api/notifications/${id}/retry - Retrying notification`);
    const notification = await retryNotification(id, Log);
    await Log('response', 'info', 'notification-service', `Notification retry successful: ${id}`);
    res.json(notification);
  } catch (error) {
    next(error);
  }
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
});

app.listen(PORT, () => {
  console.log(`server is running on port ${PORT}`);
});