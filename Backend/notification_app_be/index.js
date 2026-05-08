

const notifications = new Map();

const createNotification = (data) => {
  const id = `notif-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const notification = {
    id,
    ...data,
    status: 'pending',
    createdAt: new Date().toISOString(),
    sentAt: null,
    failureReason: null,
  };

  notifications.set(id, notification);
  return notification;
};

const sendNotification = async (notificationData, logFunction) => {
  try {
    const notif = createNotification(notificationData);

    if (logFunction) {
      await logFunction('request', 'info', 'notification-service', `Sending ${notif.type} notification to ${notif.recipient}`);
    } else {
      console.log(`[Notification] Sending ${notif.type} to ${notif.recipient} via ${notif.channel}`);
    }

    // Mark as sent
    notif.status = 'sent';
    notif.sentAt = new Date().toISOString();

    notifications.set(notif.id, notif);
    
    if (logFunction) {
      await logFunction('response', 'info', 'notification-service', `Notification sent successfully: ${notif.id}`);
    }
    
    return notif;
  } catch (error) {
    const notif = createNotification(notificationData);
    notif.status = 'failed';
    notif.failureReason = error.message;
    notifications.set(notif.id, notif);
    
    if (logFunction) {
      await logFunction('error', 'error', 'notification-service', `Failed to send notification: ${error.message}`);
    }
    
    throw error;
  }
};

const getNotification = (id) => {
  return notifications.get(id);
};

const getNotificationHistory = (depotId) => {
  return Array.from(notifications.values()).filter(n => n.depotId === depotId);
};

const retryNotification = async (id, logFunction) => {
  const notif = notifications.get(id);
  if (!notif) {
    throw new Error(`Notification ${id} not found`);
  }

  notif.status = 'pending';
  notif.failureReason = null;

  return sendNotification({
    type: notif.type,
    depotId: notif.depotId,
    recipient: notif.recipient,
    channel: notif.channel,
    content: notif.content,
  }, logFunction);
};

module.exports = {
  createNotification,
  sendNotification,
  getNotification,
  getNotificationHistory,
  retryNotification,
};
