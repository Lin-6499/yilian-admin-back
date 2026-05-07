const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getRecentHealthAlertSummary
} = require('../services/healthAlertService');

test('counts abnormal users from recent health_records and dedupes per user', async () => {
  const queryCalls = [];
  const pool = {
    async query(sql) {
      queryCalls.push(sql);

      if (/FROM health_records/i.test(sql)) {
        return [[
          {
            user_id: 1,
            systolic: 150,
            diastolic: 95,
            heart_rate: 82,
            blood_sugar: 5.5,
            temperature: 36.5,
            record_date: '2026-04-26 08:00:00'
          },
          {
            user_id: 1,
            systolic: 130,
            diastolic: 85,
            heart_rate: 120,
            blood_sugar: 3.6,
            temperature: 36.5,
            record_date: '2026-04-26 10:00:00'
          },
          {
            user_id: 2,
            systolic: 118,
            diastolic: 78,
            heart_rate: 48,
            blood_sugar: 6.0,
            temperature: 37.4,
            record_date: '2026-04-26 11:00:00'
          },
          {
            user_id: 3,
            systolic: 120,
            diastolic: 80,
            heart_rate: 75,
            blood_sugar: 5.5,
            temperature: 36.5,
            record_date: '2026-04-26 12:00:00'
          }
        ]];
      }

      if (/FROM health_data/i.test(sql)) {
        return [[]];
      }

      assert.fail(`Unexpected SQL: ${sql}`);
    }
  };

  const summary = await getRecentHealthAlertSummary(pool, {
    now: new Date('2026-04-26T12:00:00Z'),
    hours: 24
  });

  assert.equal(summary.health_alerts, 2);
  assert.equal(summary.alert_users.length, 2);
  assert.equal(summary.alert_users[0].user_id, 1);
  assert.equal(summary.alert_users[1].user_id, 2);
  assert.equal(queryCalls.filter((sql) => /FROM health_records/i.test(sql)).length, 1);
  assert.equal(queryCalls.filter((sql) => /FROM health_data/i.test(sql)).length, 1);
});

test('falls back to legacy health_data table when health_records is unavailable', async () => {
  const pool = {
    async query(sql) {
      if (/FROM health_records/i.test(sql)) {
        const error = new Error('Table does not exist');
        error.code = 'ER_NO_SUCH_TABLE';
        throw error;
      }

      assert.match(sql, /FROM health_data/i);

      if (/FROM health_data/i.test(sql)) {
        return [[
          {
            user_id: 8,
            blood_pressure_systolic: 145,
            blood_pressure_diastolic: 92,
            heart_rate: 76,
            blood_sugar: 6.1,
            measured_at: '2026-04-26 09:00:00'
          }
        ]];
      }

      assert.fail(`Unexpected SQL: ${sql}`);
    }
  };

  const summary = await getRecentHealthAlertSummary(pool, {
    now: new Date('2026-04-26T12:00:00Z'),
    hours: 24
  });

  assert.equal(summary.health_alerts, 1);
  assert.equal(summary.alert_users[0].user_id, 8);
});