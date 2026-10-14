import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { StaffLayout } from './components/StaffLayout';
import { NotFoundPage } from './pages/NotFoundPage';
import { CartPage } from './pages/customer/CartPage';
import { MenuPage } from './pages/customer/MenuPage';
import { OrderConfirmationPage } from './pages/customer/OrderConfirmationPage';
import { OrderTrackingPage } from './pages/customer/OrderTrackingPage';
import { PizzaBuilderPage } from './pages/customer/PizzaBuilderPage';
import { StaffMenuPage } from './pages/staff/StaffMenuPage';
import { StaffOrderQueuePage } from './pages/staff/StaffOrderQueuePage';

/**
 * The complete MVP route table (ADR 0007). Each route renders a page that its
 * work item replaces in place, so feature work never needs to edit this file.
 */
export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<MenuPage />} />
        <Route path="menu/:menuItemId" element={<PizzaBuilderPage />} />
        <Route path="cart" element={<CartPage />} />
        <Route path="order-confirmation/:orderId" element={<OrderConfirmationPage />} />
        <Route path="track" element={<OrderTrackingPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
      <Route path="staff" element={<StaffLayout />}>
        <Route index element={<Navigate to="orders" replace />} />
        <Route path="orders" element={<StaffOrderQueuePage />} />
        <Route path="menu" element={<StaffMenuPage />} />
      </Route>
    </Routes>
  );
}
