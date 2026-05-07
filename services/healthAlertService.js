const MISSING_TABLE_CODES = new Set(['ER_NO_SUCH_TABLE', '42S02']);

const SEVERITY_WEIGHT = {
  red: 3,
  orange: 2,
  yellow: 1,
  info: 0
};

function toNumber(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function toDate(value) {
  if (!value) {
    return null;
  }

  const dateValue = value instanceof Date ? value : new Date(value);
  return Number.isNaN(dateValue.getTime()) ? null : dateValue;
}

function normalizeHealthRecord(record) {
  return {
    userId: toNumber(record?.user_id),
    systolic: toNumber(record?.systolic ?? record?.blood_pressure_systolic),
    diastolic: toNumber(record?.diastolic ?? record?.blood_pressure_diastolic),
    heartRate: toNumber(record?.heart_rate),
    bloodSugar: toNumber(record?.blood_sugar),
    temperature: toNumber(record?.temperature),
    recordedAt: toDate(record?.record_date ?? record?.measured_at ?? record?.created_at)
  };
}

function addReason(reasons, severity, message) {
  reasons.push({ severity, message });
}

function evaluateHealthRecord(record) {
  const normalized = normalizeHealthRecord(record);
  if (normalized.userId === null || normalized.recordedAt === null) {
    return null;
  }

  const reasons = [];

  if (normalized.systolic !== null || normalized.diastolic !== null) {
    const systolic = normalized.systolic;
    const diastolic = normalized.diastolic;

    if ((systolic !== null && systolic >= 140) || (diastolic !== null && diastolic >= 90)) {
      addReason(reasons, 'red', '血压偏高');
    } else if ((systolic !== null && systolic < 90) || (diastolic !== null && diastolic < 60)) {
      addReason(reasons, 'orange', '血压偏低');
    }
  }

  if (normalized.heartRate !== null) {
    if (normalized.heartRate < 60) {
      addReason(reasons, 'orange', '心率过低');
    } else if (normalized.heartRate > 100) {
      addReason(reasons, 'orange', '心率过高');
    }
  }

  if (normalized.bloodSugar !== null) {
    if (normalized.bloodSugar < 3.9) {
      addReason(reasons, 'red', '血糖偏低');
    } else if (normalized.bloodSugar >= 11.1) {
      addReason(reasons, 'orange', '血糖偏高');
    }
  }

  if (normalized.temperature !== null) {
    if (normalized.temperature >= 38) {
      addReason(reasons, 'red', '体温过高');
    } else if (normalized.temperature >= 37.3) {
      addReason(reasons, 'orange', '体温偏高');
    } else if (normalized.temperature <= 35.5) {
      addReason(reasons, 'orange', '体温偏低');
    }
  }

  if (reasons.length === 0) {
    return null;
  }

  const severity = reasons.reduce((current, item) => {
    return SEVERITY_WEIGHT[item.severity] > SEVERITY_WEIGHT[current] ? item.severity : current;
  }, 'info');

  return {
    user_id: normalized.userId,
    recorded_at: normalized.recordedAt.toISOString(),
    recorded_at_ms: normalized.recordedAt.getTime(),
    severity,
    reasons
  };
}

function compareAlerts(left, right) {
  const severityDelta = SEVERITY_WEIGHT[right.severity] - SEVERITY_WEIGHT[left.severity];
  if (severityDelta !== 0) {
    return severityDelta;
  }

  const timeDelta = left.recorded_at_ms - right.recorded_at_ms;
  if (timeDelta !== 0) {
    return timeDelta;
  }

  return left.user_id - right.user_id;
}

function collectUniqueHealthAlerts(records) {
  const alertMap = new Map();

  for (const record of records) {
    const alert = evaluateHealthRecord(record);
    if (!alert) {
      continue;
    }

    const existingAlert = alertMap.get(alert.user_id);
    if (
      !existingAlert ||
      alert.recorded_at_ms < existingAlert.recorded_at_ms ||
      (
        alert.recorded_at_ms === existingAlert.recorded_at_ms &&
        SEVERITY_WEIGHT[alert.severity] > SEVERITY_WEIGHT[existingAlert.severity]
      )
    ) {
      alertMap.set(alert.user_id, alert);
    }
  }

  const alertUsers = Array.from(alertMap.values()).sort(compareAlerts);

  return {
    health_alerts: alertUsers.length,
    alert_users: alertUsers
  };
}

function isMissingTableError(error) {
  return Boolean(error && (MISSING_TABLE_CODES.has(error.code) || /doesn't exist|does not exist|no such table/i.test(error.message || '')));
}

async function fetchRecentHealthRecords(pool, sinceDate) {
  const tableQueries = [
    {
      tableName: 'health_records',
      sql: `SELECT user_id, systolic, diastolic, heart_rate, blood_sugar, temperature, COALESCE(record_date, created_at) AS record_date
            FROM health_records
            WHERE COALESCE(record_date, created_at) >= ?`
    },
    {
      tableName: 'health_data',
      sql: `SELECT user_id,
                   blood_pressure_systolic AS systolic,
                   blood_pressure_diastolic AS diastolic,
                   heart_rate,
                   blood_sugar,
                   NULL AS temperature,
                   measured_at AS record_date
            FROM health_data
            WHERE measured_at >= ?`
    }
  ];

  const records = [];
  const sourceTables = [];

  for (const tableQuery of tableQueries) {
    try {
      const [rows] = await pool.query(tableQuery.sql, [sinceDate]);
      sourceTables.push(tableQuery.tableName);
      records.push(...rows);
    } catch (error) {
      if (!isMissingTableError(error)) {
        throw error;
      }
    }
  }

  return {
    sourceTable: sourceTables.join(',') || null,
    records
  };
}

async function getRecentHealthAlertSummary(pool, { now = new Date(), hours = 24 } = {}) {
  const safeHours = Number.isFinite(Number(hours)) ? Math.max(1, Number(hours)) : 24;
  const sinceDate = new Date(now.getTime() - safeHours * 60 * 60 * 1000);
  const { sourceTable, records } = await fetchRecentHealthRecords(pool, sinceDate);
  const summary = collectUniqueHealthAlerts(records);

  return {
    ...summary,
    sourceTable,
    since: sinceDate.toISOString()
  };
}

module.exports = {
  collectUniqueHealthAlerts,
  evaluateHealthRecord,
  fetchRecentHealthRecords,
  getRecentHealthAlertSummary,
  isMissingTableError,
  normalizeHealthRecord
};