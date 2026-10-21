const { q } = require('../db');

async function notifyDeadlines() {
  try {
    await q(`INSERT INTO notifications(user_id,title,body,data)
      SELECT t.cleaner_id,'Deadline approaching: ' || c.code,'Your cleaning task is due within 24 hours.',
        jsonb_build_object('task_id',t.id,'complaint_id',t.complaint_id,'kind','deadline_approaching')
      FROM tasks t JOIN complaints c ON c.id=t.complaint_id
      WHERE t.due_at>now() AND t.due_at<=now()+interval '24 hours'
        AND t.status IN ('Assigned','In Progress','Correction Required')
        AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.user_id=t.cleaner_id
          AND n.data @> jsonb_build_object('task_id',t.id,'kind','deadline_approaching'))`);
    await q(`INSERT INTO notifications(user_id,title,body,data)
      SELECT u.id,'Overdue cleaning task: ' || c.code,'A cleaning task has passed its deadline.',
        jsonb_build_object('task_id',t.id,'complaint_id',t.complaint_id,'kind','overdue')
      FROM tasks t JOIN complaints c ON c.id=t.complaint_id CROSS JOIN users u
      WHERE t.due_at<now() AND t.status IN ('Assigned','In Progress','Correction Required')
        AND u.role='admin' AND u.is_active
        AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.user_id=u.id
          AND n.data @> jsonb_build_object('task_id',t.id,'kind','overdue'))`);
  } catch (error) {
    console.error('Task deadline notifications failed:', error);
  }
}

exports.start = () => {
  notifyDeadlines();
  const timer = setInterval(notifyDeadlines, 15 * 60 * 1000);
  timer.unref();
  return timer;
};
