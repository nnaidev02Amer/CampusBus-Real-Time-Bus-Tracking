export default function AdminTable({ children, stackOnMobile = false }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
      <table className={`w-full text-left text-sm ${stackOnMobile ? "block lg:table" : ""}`}>
        {children}
      </table>
    </div>
  );
}