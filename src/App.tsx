import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { VouchersProvider } from './context/VouchersContext'
import { ProtectedRoute } from './components/ProtectedRoute'
import { Layout } from './components/Layout'
import { Login } from './pages/Login'
import { Signup } from './pages/Signup'
import { ForgotPassword } from './pages/ForgotPassword'
import { ResendConfirmation } from './pages/ResendConfirmation'
import { ResetPassword } from './pages/ResetPassword'
import { Dashboard } from './pages/Dashboard'
import { UsedVouchers } from './pages/UsedVouchers'
import { AddVoucher } from './pages/AddVoucher'
import { EditVoucher } from './pages/EditVoucher'
import { ClaimShare } from './pages/ClaimShare'

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/resend-confirmation" element={<ResendConfirmation />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route
            element={
              <ProtectedRoute>
                <VouchersProvider>
                  <Layout />
                </VouchersProvider>
              </ProtectedRoute>
            }
          >
            <Route path="/" element={<Dashboard />} />
            <Route path="/used" element={<UsedVouchers />} />
            <Route path="/add" element={<AddVoucher />} />
            <Route path="/edit/:id" element={<EditVoucher />} />
            <Route path="/claim/:token" element={<ClaimShare />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
