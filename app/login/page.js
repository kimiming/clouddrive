'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, Form, Input, Button, Typography, message } from 'antd';
import { UserOutlined, LockOutlined, CloudOutlined } from '@ant-design/icons';

export default function LoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  async function onFinish(values) {
    setLoading(true);
    try {
      const res = await fetch('/api/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || '登录失败'); }
      router.push('/');
      router.refresh();
    } catch (e) { message.error(e.message); } finally { setLoading(false); }
  }
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'linear-gradient(135deg, #e6f4ff 0%, #f0f5ff 45%, #f5f6f8 100%)' }}>
      <Card style={{ width: 380, maxWidth: '94vw', borderRadius: 16, boxShadow: '0 12px 40px rgba(22,119,255,0.14)' }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <CloudOutlined style={{ fontSize: 40, color: '#1677ff' }} />
          <Typography.Title level={3} style={{ margin: '12px 0 4px' }}>协作网盘</Typography.Title>
          <Typography.Text type="secondary">登录后管理文件与 Muse 公钥</Typography.Text>
        </div>
        <Form layout="vertical" onFinish={onFinish}>
          <Form.Item name="username" rules={[{ required: true, message: '请输入账号' }]}>
            <Input prefix={<UserOutlined />} placeholder="账号" size="large" autoComplete="username" />
          </Form.Item>
          <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="密码" size="large" autoComplete="current-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" size="large" block loading={loading}>登录</Button>
        </Form>
      </Card>
    </div>
  );
}
