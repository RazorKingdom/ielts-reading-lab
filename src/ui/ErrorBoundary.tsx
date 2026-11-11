import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

interface Props { children: ReactNode }
interface State { error: Error | null }

/** Last-resort UI for uncaught render errors: never leave a blank screen. */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Log for diagnosis; never expose component stacks to end users.
    console.error('Uncaught UI error:', error.message, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="content-scroll">
        <div className="content-inner">
          <div className="notice-box danger">
            <strong>界面出现未预期错误：{error.message}</strong>
            <div className="hint" style={{ marginTop: 6 }}>
              你的学习数据保存在本地，不会因界面错误丢失。请重新载入应用；若反复出现，请导出数据后再尝试恢复。
            </div>
          </div>
          <button className="btn" style={{ marginTop: 12 }} onClick={() => window.location.reload()}>
            重新载入应用
          </button>
        </div>
      </div>
    )
  }
}
