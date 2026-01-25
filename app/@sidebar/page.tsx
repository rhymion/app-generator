import Link from "next/link";
export default function HeaderPage() {
  return <>
    <nav className="w-32 h-lvh bg-blue-600 flex-none">
      <ul className="mb-4 pl-2">
        <li className="block px-4 py-2 my-1 hover:bg-gray-100 rounded">
          <Link className="no-underline text-blue-300" href="/">
            Home</Link></li>
        <li className="block text-blue-300 px-4 py-2 my-1 hover:bg-gray-100 rounded">
          <Link className="no-underline text-blue-300" href="/db_table">
            DB Tables</Link></li>
        <li className="block text-blue-300 px-4 py-2 my-1 hover:bg-gray-100 rounded">
          <Link className="no-underline text-blue-300" href="/xxxxx_xxxxx">
            Xxxxx Xxxxx</Link></li>
      </ul>
    </nav>
  </>;
}
