import { redirect } from 'next/navigation';

// The Admin Panel is a popup (AdminPanelModal, opened from the sidebar), not
// a page. This route used to be one of three copies of it; old bookmarks
// land on the dashboard instead of a 404.
export default function AdminRedirect() {
  redirect('/dashboard');
}
