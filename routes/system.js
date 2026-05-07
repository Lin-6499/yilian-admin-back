const express = require('express');
const router = express.Router();
const pool = require('../db');
const {
  readSosConfig,
  saveSosConfig,
  resolveSosTarget
} = require('../shared/sos-config');

function requireAdmin(req, res) {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ message: '无权访问' });
    return false;
  }

  return true;
}

function handleConfigError(res, error) {
  const message = error?.message || '服务器错误';
  if (message.includes('请输入') || message.includes('格式不正确')) {
    return res.status(400).json({ message });
  }

  console.error(error);
  return res.status(500).json({ message: '服务器错误' });
}

router.get('/sos', async (req, res) => {
  if (!requireAdmin(req, res)) return;

  try {
    const config = await readSosConfig({ env: process.env });
    res.json({
      config,
      effective: {
        dialEnabled: config.dialEnabled,
        defaultContactName: config.defaultContactName,
        defaultPhone: config.defaultPhone
      }
    });
  } catch (error) {
    handleConfigError(res, error);
  }
});

router.put('/sos', async (req, res) => {
  if (!requireAdmin(req, res)) return;

  try {
    const config = await saveSosConfig(req.body || {}, {
      env: process.env,
      operator: req.user
    });

    res.json({
      message: 'SOS 配置已保存',
      config
    });
  } catch (error) {
    handleConfigError(res, error);
  }
});

router.post('/sos/test', async (req, res) => {
  if (!requireAdmin(req, res)) return;

  try {
    const config = await readSosConfig({ env: process.env });
    const rawUserId = req.body?.user_id ?? req.body?.userId ?? null;
    const userId = rawUserId === null || rawUserId === '' ? null : Number(rawUserId);

    let user = null;
    let familyContacts = [];

    if (userId !== null && Number.isFinite(userId)) {
      const [users] = await pool.query(
        'SELECT id, username, real_name, emergency_contact, emergency_phone FROM users WHERE id = ?',
        [userId]
      );

      if (users.length === 0) {
        return res.status(404).json({ message: '用户不存在' });
      }

      user = users[0];

      const [familyBindings] = await pool.query(
        'SELECT family_id, nickname FROM family_elderly_bindings WHERE elderly_id = ? AND status = "approved"',
        [userId]
      );

      if (familyBindings.length > 0) {
        const familyIds = familyBindings.map((item) => item.family_id);
        const [familyUsers] = await pool.query(
          `SELECT id, username, real_name, phone
           FROM users
           WHERE id IN (?)`,
          [familyIds]
        );

        const familyUserMap = new Map(familyUsers.map((item) => [item.id, item]));
        familyContacts = familyBindings.map((binding) => {
          const familyUser = familyUserMap.get(binding.family_id);
          return {
            user_id: binding.family_id,
            contact_name: binding.nickname || familyUser?.real_name || familyUser?.username || '家属联系人',
            phone: familyUser?.phone || ''
          };
        });
      }
    }

    const dialTarget = resolveSosTarget({
      user,
      familyContacts,
      config,
      env: process.env
    });

    res.json({
      message: 'SOS 配置测试完成',
      dial_target: dialTarget,
      config
    });
  } catch (error) {
    handleConfigError(res, error);
  }
});

module.exports = router;