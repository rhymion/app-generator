import Link from "next/link";
export default function HeaderPage() {
  return <>
    <nav className="w-32 h-lvh bg-gray-200 flex-none">
      <ul className="mb-4 pl-2">
        <li className="block px-4 py-2 my-1 hover:bg-gray-100 rounded">
          <Link className="no-underline text-gray-600" href="/">
            Home</Link></li>
        <li className="block text-blue-300 px-4 py-2 my-1 hover:bg-gray-100 rounded">
          <Link className="no-underline text-blue-300" href="/db_table">
            DB Tables</Link></li>
        <li className="block text-blue-300 px-4 py-2 my-1 hover:bg-gray-100 rounded">
          <Link className="no-underline text-blue-300" href="/xxxxx_xxxxx">
            Xxxxx Xxxxx</Link></li>
        <li className="block text-blue-300 px-4 py-2 my-1 hover:bg-gray-100 rounded">
          <Link className="no-underline text-blue-300" href="/parent_only">
            Parent Only</Link></li>
        <li className="block text-blue-300 px-4 py-2 my-1 hover:bg-gray-100 rounded">
          <Link className="no-underline text-blue-300" href="/parent1">
            Parent1</Link></li>
        <li className="block text-gray-600 px-4 py-2 my-1 hover:bg-gray-100 rounded">
          <Link className="no-underline text-gray-600" href="/user_account">
            User Account</Link></li>
        <li className="block text-gray-600 px-4 py-2 my-1 hover:bg-gray-100 rounded">
          <Link className="no-underline text-gray-600" href="/role">
            Role</Link></li>
        <li className="block text-gray-600 px-4 py-2 my-1 hover:bg-gray-100 rounded">
          <Link className="no-underline text-gray-600" href="/organization">
            Organization</Link></li>
        <li className="block text-gray-600 px-4 py-2 my-1 hover:bg-gray-100 rounded">
          <Link className="no-underline text-gray-600" href="/permission">
            Permission</Link></li>
      </ul>
    </nav>
  </>;
}
