'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Layout, Typography, Button, Tabs, Table, Tag, Space, Upload, message,
  Popconfirm, Modal, Form, Input, Card, Statistic, Row, Col, Image, Alert, Empty,
  Segmented, Tooltip, Spin, Progress,
} from 'antd';
import {
  CloudOutlined, LogoutOutlined, InboxOutlined, DownloadOutlined, DeleteOutlined,
  EyeOutlined, KeyOutlined, PlusOutlined, FileOutlined, PictureOutlined, VideoCameraOutlined,
  SearchOutlined, PlayCircleOutlined, CustomerServiceOutlined,
  PauseOutlined, RedoOutlined, CloseOutlined,
} from '@ant-design/icons';

const { Header, Content } = Layout;

function fmtSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
function fmtDate(t) {
  return new Date(t).toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function fileUrl(name, download) {
  return `/api/files/${encodeURIComponent(name)}${download ? '?download=1' : ''}`;
}
const CAT_TAG = { image: ['图片', 'green'], video: ['视频', 'purple'], audio: ['音频', 'orange'], file: ['文件', 'default'] };

export default function HomePage() {
  const router = useRouter();
  const [files, setFiles] = useState([]);
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState(null);
  const [keyModal, setKeyModal] = useState(false);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [keyForm] = Form.useForm();
  const [tasks, setTasks] = useState([]);
  const tasksRef = useRef([]);
  const activeRef = useRef(0);
  const controlsRef = useRef(new Map());

  const loadFiles = useCallback(async () => {
    const r = await fetch('/api/files'); const d = await r.json().catch(() => ({}));
    setFiles(d.files || []);
  }, []);
  const loadKeys = useCallback(async () => {
    const r = await fetch('/api/keys'); const d = await r.json().catch(() => ({}));
    setKeys(d.keys || []);
  }, []);
  const loadAll = useCallback(async () => {
    setLoading(true);
    try { await Promise.all([loadFiles(), loadKeys()]); } finally { setLoading(false); }
  }, [loadFiles, loadKeys]);
  useEffect(() => { loadAll(); }, [loadAll]);

  // ---------- 上传队列：排序 + 并发控制 + 分片断点续传 ----------
  const CHUNK_SIZE = 4 * 1024 * 1024;
  const CONCURRENCY = 2;

  function syncTasks(next) { tasksRef.current = next; setTasks(next); }
  function updateTask(uid, patch) {
    syncTasks(tasksRef.current.map((t) => (t.uid === uid ? { ...t, ...patch } : t)));
  }
  function getTask(uid) { return tasksRef.current.find((t) => t.uid === uid); }

  function enqueue(fileList) {
    const batch = Array.from(fileList).map((f) => ({
      uid: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${f.name}`,
      file: f, name: f.name, size: f.size, status: 'queued', percent: 0, error: '',
    }));
    // 同一批按文件名排序后入队，保证上传顺序稳定
    batch.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
    batch.forEach((t) => controlsRef.current.set(t.uid, { paused: false, xhr: null }));
    syncTasks([...tasksRef.current, ...batch]);
    setTimeout(pump, 0);
  }

  function pump() {
    while (activeRef.current < CONCURRENCY) {
      const next = tasksRef.current.find((t) => t.status === 'queued');
      if (!next) return;
      activeRef.current += 1;
      updateTask(next.uid, { status: 'uploading', error: '' });
      runUpload(next.uid).finally(() => { activeRef.current -= 1; pump(); });
    }
  }

  async function runUpload(uid) {
    const task = getTask(uid);
    if (!task) return;
    const ctrl = controlsRef.current.get(uid);
    try {
      if (task.size > CHUNK_SIZE) await uploadChunked(uid, task.file, ctrl);
      else await uploadSingle(uid, task.file, ctrl);
      if (ctrl.paused) { updateTask(uid, { status: 'paused' }); return; }
      updateTask(uid, { status: 'done', percent: 100 });
      message.success(`${task.name} 上传成功`);
      loadFiles();
    } catch (e) {
      if (ctrl.paused) updateTask(uid, { status: 'paused' });
      else updateTask(uid, { status: 'error', error: e.message || '上传失败' });
    }
  }

  function uploadSingle(uid, file, ctrl) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      ctrl.xhr = xhr;
      xhr.open('POST', '/api/files');
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) updateTask(uid, { percent: Math.floor((e.loaded / e.total) * 100) });
      };
      xhr.onload = () => {
        ctrl.xhr = null;
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else {
          try { reject(new Error(JSON.parse(xhr.responseText).error || '上传失败')); }
          catch { reject(new Error('上传失败')); }
        }
      };
      xhr.onerror = () => { ctrl.xhr = null; reject(new Error('网络错误，点重试可重新上传')); };
      xhr.onabort = () => { ctrl.xhr = null; reject(new Error('已暂停')); };
      const fd = new FormData();
      fd.append('file', file);
      xhr.send(fd);
    });
  }

  async function uploadChunked(uid, file, ctrl) {
    const initRes = await fetch('/api/upload/init', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: file.name, size: file.size, chunkSize: CHUNK_SIZE, lastModified: file.lastModified }),
    });
    const init = await initRes.json().catch(() => ({}));
    if (!initRes.ok) throw new Error(init.error || '初始化分片上传失败');
    const uploadedSet = new Set(init.uploaded || []);
    const total = init.totalChunks;
    let doneBytes = 0;
    for (let i = 0; i < total; i++) {
      if (uploadedSet.has(i)) doneBytes += Math.min(CHUNK_SIZE, file.size - i * CHUNK_SIZE);
    }
    updateTask(uid, { percent: Math.floor((doneBytes / file.size) * 100) });
    for (let i = 0; i < total; i++) {
      if (uploadedSet.has(i)) continue;
      if (ctrl.paused) return; // 已传分片保留在服务器，恢复时自动跳过
      const blob = file.slice(i * CHUNK_SIZE, Math.min(file.size, (i + 1) * CHUNK_SIZE));
      const fd = new FormData();
      fd.append('uploadId', init.uploadId);
      fd.append('index', String(i));
      fd.append('chunk', blob);
      const r = await fetch('/api/upload/chunk', { method: 'POST', body: fd });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || `分片 ${i + 1}/${total} 上传失败，点重试可续传`);
      }
      doneBytes += blob.size;
      updateTask(uid, { percent: Math.floor((doneBytes / file.size) * 100) });
    }
    if (ctrl.paused) return;
    const cRes = await fetch('/api/upload/complete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadId: init.uploadId }),
    });
    const c = await cRes.json().catch(() => ({}));
    if (!cRes.ok) throw new Error(c.error || '组装文件失败');
  }

  function pauseTask(uid) {
    const ctrl = controlsRef.current.get(uid);
    if (!ctrl) return;
    ctrl.paused = true;
    if (ctrl.xhr) ctrl.xhr.abort();
    updateTask(uid, { status: 'paused' });
  }
  function resumeTask(uid) {
    const ctrl = controlsRef.current.get(uid);
    if (!ctrl) return;
    ctrl.paused = false;
    updateTask(uid, { status: 'queued', error: '' });
    setTimeout(pump, 0);
  }
  function removeTask(uid) {
    pauseTask(uid);
    controlsRef.current.delete(uid);
    syncTasks(tasksRef.current.filter((t) => t.uid !== uid));
  }
  function clearDoneTasks() {
    syncTasks(tasksRef.current.filter((t) => t.status !== 'done'));
  }
  // ---------- 上传队列结束 ----------

  async function logout() {
    await fetch('/api/logout', { method: 'POST' });
    router.push('/login');
  }
  async function deleteFile(name) {
    await fetch(fileUrl(name), { method: 'DELETE' });
    message.success('已删除'); loadFiles();
  }
  async function addKey() {
    const v = await keyForm.validateFields();
    const r = await fetch('/api/keys', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: v.key, name: v.name }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { message.error(d.error || '添加失败'); return; }
    message.success('公钥已添加，对方现在可以通过 SSH 访问这台服务器');
    setKeyModal(false); keyForm.resetFields(); loadKeys();
  }
  async function deleteKey(body) {
    const r = await fetch('/api/keys', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { message.error(d.error || '删除失败'); return; }
    message.success('公钥已移除'); loadKeys();
  }

  const totalSize = files.reduce((s, f) => s + f.size, 0);
  const imgCount = files.filter((f) => f.category === 'image').length;
  const vidCount = files.filter((f) => f.category === 'video').length;

  const shownFiles = useMemo(() => files.filter((f) => {
    if (filter !== 'all' && f.category !== filter) return false;
    if (query && !f.name.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  }), [files, filter, query]);

  function fileCard(f) {
    const canPreview = f.category === 'image' || f.category === 'video';
    return (
      <Col key={f.name} xs={12} sm={8} md={6} xl={4}>
        <Card
          className="file-card" hoverable styles={{ body: { padding: 12 } }}
          cover={
            <div className="file-cover" onClick={() => canPreview && setPreview(f)}>
              {f.category === 'image' && <img src={fileUrl(f.name)} alt={f.name} loading="lazy" />}
              {f.category === 'video' && (
                <div className="file-cover-placeholder video">
                  <PlayCircleOutlined style={{ fontSize: 44, color: '#fff' }} />
                </div>
              )}
              {f.category === 'audio' && (
                <div className="file-cover-placeholder audio"><CustomerServiceOutlined style={{ fontSize: 40 }} /></div>
              )}
              {f.category === 'file' && (
                <div className="file-cover-placeholder plain"><FileOutlined style={{ fontSize: 40 }} /></div>
              )}
            </div>
          }
          actions={[
            canPreview ? (
              <Tooltip key="preview" title="预览">
                <span className="card-action" onClick={() => setPreview(f)}><EyeOutlined /> 预览</span>
              </Tooltip>
            ) : (
              <Tooltip key="preview" title="此类型不支持预览">
                <span className="card-action disabled"><EyeOutlined /> 预览</span>
              </Tooltip>
            ),
            <Tooltip key="download" title="下载">
              <a className="card-action" href={fileUrl(f.name, true)}><DownloadOutlined /> 下载</a>
            </Tooltip>,
            <Popconfirm key="delete" title="确定删除这个文件吗？" description={f.name} onConfirm={() => deleteFile(f.name)} okText="删除" okButtonProps={{ danger: true }} cancelText="取消">
              <span className="card-action danger"><DeleteOutlined /> 删除</span>
            </Popconfirm>,
          ]}
        >
          <Typography.Text strong ellipsis={{ tooltip: f.name }} style={{ display: 'block', fontSize: 13 }}>{f.name}</Typography.Text>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6, gap: 6, flexWrap: 'wrap' }}>
            <Tag color={CAT_TAG[f.category][1]} style={{ margin: 0 }}>{CAT_TAG[f.category][0]}</Tag>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>{fmtSize(f.size)}</Typography.Text>
          </div>
          <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 4 }}>{fmtDate(f.mtime)}</Typography.Text>
        </Card>
      </Col>
    );
  }

  const keyColumns = [
    { title: '同事名字', width: 160, render: (_, k) => k.comment ? <Typography.Text strong>{k.comment}</Typography.Text> : <Typography.Text type="secondary">（未填写名字）</Typography.Text> },
    { title: '类型', dataIndex: 'type', width: 130 },
    { title: '指纹', width: 260, render: (_, k) => <Typography.Text code copyable={k.fingerprint ? { text: k.fingerprint } : false} ellipsis style={{ maxWidth: 230, fontSize: 12 }}>{k.fingerprint || '-'}</Typography.Text> },
    { title: '状态', width: 190, render: (_, k) => k.protected ? <Tag color="blue">Jackson 的 Muse · 受保护</Tag> : <Tag color="green">可 SSH 访问</Tag> },
    {
      title: '操作', width: 100, fixed: 'right',
      render: (_, k) => k.protected
        ? <Typography.Text type="secondary">不可删除</Typography.Text>
        : (
          <Popconfirm title="移除后对方将无法再 SSH 访问，确定吗？" onConfirm={() => deleteKey(k.body)} okText="移除" okButtonProps={{ danger: true }} cancelText="取消">
            <Button size="small" danger icon={<DeleteOutlined />}>移除</Button>
          </Popconfirm>
        ),
    },
  ];

  return (
    <Layout style={{ minHeight: '100vh', background: '#f5f6f8' }}>
      <Header style={{ position: 'sticky', top: 0, zIndex: 100, background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '0 16px', boxShadow: '0 1px 6px rgba(0,0,0,0.06)', height: 60, lineHeight: 'normal' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg,#1677ff,#69b1ff)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <CloudOutlined style={{ fontSize: 20, color: '#fff' }} />
          </div>
          <div style={{ lineHeight: 1.25, minWidth: 0 }}>
            <Typography.Title level={5} style={{ margin: 0 }} ellipsis>协作网盘</Typography.Title>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>文件共享 · Muse 公钥管理</Typography.Text>
          </div>
        </div>
        <Button icon={<LogoutOutlined />} onClick={logout} style={{ flexShrink: 0 }}>退出</Button>
      </Header>

      <Content className="main-content">
        <Tabs
          defaultActiveKey="files" size="large"
          items={[
            {
              key: 'files', label: '📁 我的文件',
              children: (
                <>
                  <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
                    <Col xs={12} md={6}><Card size="small" className="stat-card"><Statistic title="文件总数" value={files.length} /></Card></Col>
                    <Col xs={12} md={6}><Card size="small" className="stat-card"><Statistic title="占用空间" value={fmtSize(totalSize)} /></Card></Col>
                    <Col xs={12} md={6}><Card size="small" className="stat-card"><Statistic title="图片" value={imgCount} prefix={<PictureOutlined style={{ color: '#52c41a' }} />} /></Card></Col>
                    <Col xs={12} md={6}><Card size="small" className="stat-card"><Statistic title="视频" value={vidCount} prefix={<VideoCameraOutlined style={{ color: '#722ed1' }} />} /></Card></Col>
                  </Row>

                  <Upload.Dragger
                    multiple showUploadList={false}
                    beforeUpload={(file, fileList) => {
                      if (fileList && fileList[0] === file) enqueue(fileList);
                      return false;
                    }}
                    style={{ marginBottom: 12, borderRadius: 14 }}
                  >
                    <p className="ant-upload-drag-icon" style={{ marginBottom: 4 }}><InboxOutlined style={{ fontSize: 36 }} /></p>
                    <p className="ant-upload-text">点击或拖拽文件到这里上传</p>
                    <p className="ant-upload-hint">可以一次拖几十个文件：自动按文件名排序排队（同时传 2 个），大文件（&gt;4MB）自动分片、支持暂停和断点续传</p>
                  </Upload.Dragger>

                  {tasks.length > 0 && (
                    <Card size="small" style={{ marginBottom: 12, borderRadius: 14 }} styles={{ body: { padding: 12 } }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
                        <Typography.Text strong>上传队列（{tasks.filter((t) => t.status === 'done').length}/{tasks.length} 已完成）</Typography.Text>
                        <Progress
                          percent={tasks.length ? Math.floor(tasks.reduce((s, t) => s + (t.size * t.percent) / 100, 0) / Math.max(1, tasks.reduce((s, t) => s + t.size, 0)) * 100) : 0}
                          style={{ flex: 1, minWidth: 140, margin: 0 }}
                        />
                        <Button size="small" onClick={clearDoneTasks}>清除已完成</Button>
                      </div>
                      <div style={{ maxHeight: 264, overflowY: 'auto' }}>
                        {tasks.map((t) => (
                          <div key={t.uid} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderTop: '1px solid #f5f5f5' }}>
                            <Typography.Text ellipsis={{ tooltip: t.name }} style={{ flex: 1, minWidth: 80, fontSize: 13 }}>{t.name}</Typography.Text>
                            <Typography.Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{fmtSize(t.size)}</Typography.Text>
                            <Progress percent={t.percent} size="small" style={{ width: 130, margin: 0 }} status={t.status === 'error' ? 'exception' : t.status === 'done' ? 'success' : 'active'} />
                            {t.status === 'queued' && <Tag>排队中</Tag>}
                            {t.status === 'uploading' && <Tag color="blue">上传中</Tag>}
                            {t.status === 'paused' && <Tag color="orange">已暂停</Tag>}
                            {t.status === 'error' && <Tooltip title={t.error}><Tag color="red">失败</Tag></Tooltip>}
                            {t.status === 'done' && <Tag color="green">完成</Tag>}
                            {t.status === 'uploading' && (
                              <Button size="small" icon={<PauseOutlined />} onClick={() => pauseTask(t.uid)}>暂停</Button>
                            )}
                            {(t.status === 'paused' || t.status === 'error') && (
                              <Button size="small" type="primary" icon={<RedoOutlined />} onClick={() => resumeTask(t.uid)}>{t.status === 'error' ? '重试' : '继续'}</Button>
                            )}
                            <Button size="small" type="text" icon={<CloseOutlined />} onClick={() => removeTask(t.uid)} />
                          </div>
                        ))}
                      </div>
                    </Card>
                  )}

                  <div className="toolbar">
                    <Segmented
                      value={filter} onChange={setFilter}
                      options={[
                        { label: `全部 ${files.length}`, value: 'all' },
                        { label: `图片 ${imgCount}`, value: 'image' },
                        { label: `视频 ${vidCount}`, value: 'video' },
                        { label: '其他', value: 'file' },
                      ]}
                    />
                    <Input
                      allowClear prefix={<SearchOutlined />} placeholder="搜索文件名"
                      value={query} onChange={(e) => setQuery(e.target.value)}
                      style={{ width: 220, maxWidth: '100%' }}
                    />
                  </div>

                  {loading ? (
                    <div style={{ textAlign: 'center', padding: 48 }}><Spin size="large" /></div>
                  ) : shownFiles.length === 0 ? (
                    <Card style={{ borderRadius: 14 }}>
                      <Empty description={files.length === 0 ? '还没有文件，先上传一个吧' : '没有符合条件的文件'} />
                    </Card>
                  ) : (
                    <Row gutter={[12, 12]}>{shownFiles.map(fileCard)}</Row>
                  )}
                </>
              ),
            },
            {
              key: 'keys', label: '🔑 Muse 公钥',
              children: (
                <>
                  <Alert type="info" showIcon style={{ marginBottom: 12, borderRadius: 12 }}
                    message="把同事的 Muse 公钥加到这里，对方的 Muse 就能通过 SSH 访问这台服务器（root 用户），也能读写网盘里的文件。"
                    description="点「添加同事公钥」，分开填两项就行：① 同事的名字 ② 公钥（让同事叫他的 Muse 把公钥发给他，复制粘贴过来，可以是一整行，也可以只粘贴 AAAA 开头的那一长串）。移除公钥后，对方立即无法再访问。" />
                  <Button type="primary" icon={<PlusOutlined />} style={{ marginBottom: 12 }} onClick={() => setKeyModal(true)}>添加同事公钥</Button>
                  <div className="table-card">
                    <Table rowKey={(k) => k.body || k.raw} columns={keyColumns} dataSource={keys} loading={loading}
                      scroll={{ x: 840 }} locale={{ emptyText: <Empty description="还没有任何公钥" /> }} pagination={false} />
                  </div>
                </>
              ),
            },
          ]}
        />
      </Content>

      <Modal open={!!preview} onCancel={() => setPreview(null)} footer={null} width={860} style={{ maxWidth: '95vw' }} title={preview?.name}>
        {preview?.category === 'image' && <Image src={fileUrl(preview.name)} alt={preview.name} style={{ width: '100%' }} preview={false} />}
        {preview?.category === 'video' && <video src={fileUrl(preview.name)} controls style={{ width: '100%', maxHeight: '70vh' }} />}
      </Modal>

      <Modal open={keyModal} onCancel={() => setKeyModal(false)} onOk={addKey} okText="添加" cancelText="取消" title={<span><KeyOutlined /> 添加同事的 Muse 公钥</span>} width={640} style={{ maxWidth: '95vw' }}>
        <Form form={keyForm} layout="vertical">
          <Form.Item name="name" label="① 同事的名字" rules={[{ required: true, message: '请填写同事的名字' }, { max: 50, message: '名字太长了' }]}>
            <Input placeholder="例如：张三" size="large" />
          </Form.Item>
          <Form.Item name="key" label="② 同事的 Muse 公钥" rules={[{ required: true, message: '请粘贴公钥' }]}>
            <Input.TextArea rows={4} placeholder={"把同事发来的公钥粘贴到这里，可以是这样的一整行：\nssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA...\n也可以只粘贴 AAAA 开头的那一长串"} style={{ fontFamily: 'monospace', fontSize: 12 }} />
          </Form.Item>
          <Typography.Text type="secondary">怎么拿到公钥：让同事对他的 Muse 说「把你的 SSH 公钥发给我」，他复制发给你就行，不需要懂技术细节。名字和公钥是分开保存的，方便以后查找和移除。</Typography.Text>
        </Form>
      </Modal>
    </Layout>
  );
}
