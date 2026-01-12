import Link from "next/link";
export default function HeaderPage() {
  return <>
    <h1 className="text-4xl text-indigo-800 font-bold my-2">
      Reading Recorder</h1>
    <nav>
      <ul className="flex bg-blue-600 mb-4 pl-2">
        <li className="block px-4 py-2 my-1 hover:bg-gray-100 rounded">
          <Link className="no-underline text-blue-300" href="/">
            Home</Link></li>
        <li className="block text-blue-300 px-4 py-2 my-1 hover:bg-gray-100 rounded">
          <Link className="no-underline text-blue-300" href="/reviews">
            My Reviews</Link></li>
        <li className="block text-blue-300 px-4 py-2 my-1 hover:bg-gray-100 rounded">
          <Link className="no-underline text-blue-300" href="/books">
            Search</Link></li>
        <li className="block text-blue-300 px-4 py-2 my-1 hover:bg-gray-100 rounded">
          <a className="no-underline text-blue-300"
            href="https://wings.msn.to/" target="_blank">Support</a></li>
        <li className="block text-blue-300 px-4 py-2 my-1 hover:bg-gray-100 rounded">
          <Link className="no-underline text-blue-300" href="/login">
            Sign In</Link></li>
      </ul>
    </nav>
  </>;
}
