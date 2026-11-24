import { AntdRegistry } from '@ant-design/nextjs-registry';
import './globals.css';

export const metadata = { title: '协作网盘', description: '文件共享与 Muse 公钥管理' };

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body style={{ fontFamily: 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif' }}>
        <AntdRegistry>{children}</AntdRegistry>
      </body>
    </html>
  );
}
