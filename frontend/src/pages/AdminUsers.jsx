import { useEffect, useState } from "react";
import Layout from "../components/Layout";
import AdminTable from "../components/AdminTable";
import { busApi, userApi } from "../services/api";
import { Plus, Trash2, Pencil, KeyRound, Power } from "lucide-react";
export function AdminUsers({ role, title }) {
  const [users, setUsers] = useState([]);
  const [buses, setBuses] = useState([]);
  const [assignmentDrafts, setAssignmentDrafts] = useState({});
  const [listError, setListError] = useState("");
  const [actionError, setActionError] = useState("");
  const [dialogMode, setDialogMode] = useState("");
  const [targetDriver, setTargetDriver] = useState(null);
  const [saving, setSaving] = useState(false);
  const [busyDriverId, setBusyDriverId] = useState("");
  const [formError, setFormError] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    phone: "",
  });
  const loadUsers = async () => {
    setListError("");
    if (role === "driver") {
      const [driverResponse, busResponse] = await Promise.all([
        userApi.listDrivers(),
        busApi.list(),
      ]);
      const drivers = driverResponse.data.drivers;
      setUsers(drivers);
      setBuses(busResponse.data.buses);
      setAssignmentDrafts(
        Object.fromEntries(
          drivers.map((driver) => [driver._id, driver.assignedBus?._id || ""]),
        ),
      );
      return;
    }
    const response = await userApi.list(role);
    setUsers(response.data.users);
  };

  useEffect(() => {
    setActionError("");
    loadUsers().catch(() =>
      setListError(
        "Unable to load users. Check your connection and try again.",
      ),
    );
  }, [role]);

  const openDialog = (mode, driver = null) => {
    setTargetDriver(driver);
    setFormError("");
    setConfirmPassword("");
    setForm(
      mode === "edit"
        ? {
            name: driver.name,
            email: driver.email,
            password: "",
            phone: driver.phone || "",
          }
        : { name: "", email: "", password: "", phone: "" },
    );
    setDialogMode(mode);
  };

  const saveDialog = async (event) => {
    event.preventDefault();
    setSaving(true);
    setFormError("");
    try {
      if (dialogMode === "create") {
        const response = await userApi.createDriver(form);
        setUsers((current) => [
          {
            ...response.data.user,
            assignedBus: null,
            assignedRoute: null,
            currentTrip: null,
            lastActivityAt: null,
            hasTripHistory: false,
          },
          ...current.filter((user) => user._id !== response.data.user._id),
        ]);
        setAssignmentDrafts((current) => ({
          ...current,
          [response.data.user._id]: "",
        }));
      } else if (dialogMode === "edit") {
        const response = await userApi.updateDriver(targetDriver._id, {
          name: form.name,
          email: form.email,
          phone: form.phone,
        });
        setUsers((current) =>
          current.map((driver) =>
            driver._id === targetDriver._id
              ? { ...driver, ...response.data.user }
              : driver,
          ),
        );
      } else if (dialogMode === "password") {
        if (form.password !== confirmPassword) {
          setFormError("The passwords do not match.");
          return;
        }
        await userApi.resetDriverPassword(targetDriver._id, form.password);
      }
      setForm({ name: "", email: "", password: "", phone: "" });
      setDialogMode("");
    } catch (error) {
      setFormError(
        error.response?.data?.message ||
          "Unable to save driver changes. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  };

  const toggleDriverStatus = async (driver) => {
    const nextStatus = !driver.isActive;
    if (
      !nextStatus &&
      !window.confirm(
        `Deactivate ${driver.name}'s account? They will not be able to sign in or send GPS updates.`,
      )
    ) {
      return;
    }
    setBusyDriverId(driver._id);
    setActionError("");
    try {
      const response = await userApi.updateDriverStatus(driver._id, nextStatus);
      setUsers((current) =>
        current.map((item) =>
          item._id === driver._id ? { ...item, ...response.data.user } : item,
        ),
      );
    } catch (error) {
      setActionError(
        error.response?.data?.message ||
          "Unable to update driver account status.",
      );
    } finally {
      setBusyDriverId("");
    }
  };

  const saveDriverAssignment = async (driver) => {
    const selectedBusId = assignmentDrafts[driver._id] || "";
    const currentBusId = driver.assignedBus?._id || "";
    if (selectedBusId && currentBusId && selectedBusId !== currentBusId) {
      setActionError(
        "Unassign the driver from their current bus before assigning another bus.",
      );
      return;
    }
    setBusyDriverId(driver._id);
    setActionError("");
    try {
      const busId = selectedBusId || currentBusId;
      if (busId)
        await busApi.assignDriver(busId, selectedBusId ? driver._id : null);
      await loadUsers();
    } catch (error) {
      setActionError(
        error.response?.data?.message ||
          "Unable to update the driver assignment.",
      );
    } finally {
      setBusyDriverId("");
    }
  };

  const removeDriver = async (driver) => {
    if (
      !window.confirm(
        `Permanently delete ${driver.name}'s account? This cannot be undone.`,
      )
    ) {
      return;
    }
    setBusyDriverId(driver._id);
    setActionError("");
    try {
      await userApi.deleteDriver(driver._id);
      setUsers((current) => current.filter((item) => item._id !== driver._id));
    } catch (error) {
      setActionError(
        error.response?.data?.message ||
          "Unable to delete this driver account.",
      );
    } finally {
      setBusyDriverId("");
    }
  };

  return (
    <Layout>
      <div className="space-y-5">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <h1 className="text-3xl font-black">{title}</h1>
          {role === "driver" && (
            <button
              type="button"
              onClick={() => {
                setActionError("");
                openDialog("create");
              }}
              aria-haspopup="dialog"
              className="flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700"
            >
              <Plus size={17} /> Add Driver
            </button>
          )}
        </div>
        {listError && (
          <p
            role="alert"
            className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700"
          >
            {listError}
          </p>
        )}
        {actionError && (
          <p
            role="alert"
            className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700"
          >
            {actionError}
          </p>
        )}
        {role === "driver" ? (
          <AdminTable stackOnMobile>
            <thead className="hidden lg:table-header-group">
              <tr className="border-b bg-slate-50 text-xs uppercase text-slate-500">
                <th className="p-4">Driver</th>
                <th>Email</th>
                <th className="pr-4">Account</th>
                <th>Bus assignment</th>
                <th>Current trip</th>
                <th>Last activity</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody className="block lg:table-row-group">
              {users.map((driver) => {
                const assignedBusId = driver.assignedBus?._id || "";
                const selectedBusId =
                  assignmentDrafts[driver._id] ?? assignedBusId;
                const canDelete =
                  !driver.isActive &&
                  !driver.assignedBus &&
                  !driver.hasTripHistory &&
                  !driver.currentTrip;
                const availableBuses = buses.filter((bus) => {
                  const assignedDriverId =
                    typeof bus.driverId === "object"
                      ? bus.driverId?._id
                      : bus.driverId;
                  return driver.isActive
                    ? !assignedDriverId || assignedDriverId === driver._id
                    : assignedDriverId === driver._id;
                });

                return (
                  <tr
                    key={driver._id}
                    className="grid grid-cols-2 gap-x-3 gap-y-3 border-b p-4 last:border-0 lg:table-row lg:p-0"
                  >
                    <td className="lg:table-cell lg:p-4">
                      <p className="font-bold text-slate-900">{driver.name}</p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {driver.phone || "No phone"}
                      </p>
                    </td>
                    <td className="col-span-2 min-w-0 break-words text-sm lg:col-span-1 lg:table-cell lg:whitespace-nowrap lg:pr-4">
                      <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-500 lg:hidden">Email</span>
                      {driver.email}
                    </td>
                    <td className="lg:table-cell lg:pr-4">
                      <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-500 lg:hidden">Account</span>
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-bold ${driver.isActive ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}
                      >
                        {driver.isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="col-span-2 lg:table-cell lg:min-w-64 lg:py-3 lg:pr-4">
                      <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-500 lg:hidden">Bus assignment</span>
                      <p className="font-semibold">
                        {driver.assignedBus?.busNumber || "Unassigned"}
                      </p>
                      <p className="mb-2 text-xs text-slate-500">
                        {driver.assignedRoute?.name || "No route"}
                      </p>
                      <div className="flex items-center gap-2">
                        <select
                          value={selectedBusId}
                          disabled={busyDriverId === driver._id}
                          onChange={(event) =>
                            setAssignmentDrafts({
                              ...assignmentDrafts,
                              [driver._id]: event.target.value,
                            })
                          }
                          aria-label={`Assign bus to ${driver.name}`}
                          className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 py-2.5 text-sm lg:py-2 lg:text-xs"
                        >
                          <option value="">Unassigned</option>
                          {availableBuses.map((bus) => (
                            <option key={bus._id} value={bus._id}>
                              {bus.busNumber} ·{" "}
                              {bus.routeId?.name || "No route"}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          disabled={
                            busyDriverId === driver._id ||
                            selectedBusId === assignedBusId
                          }
                          onClick={() => saveDriverAssignment(driver)}
                          className="min-h-10 rounded-lg bg-slate-900 px-3 py-2 text-sm font-bold text-white disabled:opacity-40 lg:min-h-0 lg:text-xs"
                        >
                          {busyDriverId === driver._id ? "Saving…" : "Save"}
                        </button>
                      </div>
                    </td>
                    <td className="text-sm lg:table-cell lg:min-w-40 lg:pr-4">
                      <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-500 lg:hidden">Current trip</span>
                      {driver.currentTrip ? (
                        <>
                          <p className="font-bold text-emerald-700">Active</p>
                          <p className="text-xs text-slate-500">
                            {driver.currentTrip.route?.name ||
                              driver.currentTrip.bus?.busNumber ||
                              "Trip in progress"}
                          </p>
                        </>
                      ) : (
                        <span className="text-slate-500">No active trip</span>
                      )}
                    </td>
                    <td className="text-xs text-slate-500 lg:table-cell lg:min-w-36 lg:pr-4">
                      <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-500 lg:hidden">Last activity</span>
                      {driver.lastActivityAt
                        ? new Date(driver.lastActivityAt).toLocaleString()
                        : "No activity recorded"}
                    </td>
                    <td className="col-span-2 lg:table-cell lg:min-w-44 lg:py-3 lg:pr-4">
                      <div className="flex flex-wrap gap-2 lg:gap-1.5">
                        <button
                          type="button"
                          title="Edit driver details"
                          aria-label={`Edit ${driver.name}`}
                          onClick={() => openDialog("edit", driver)}
                          disabled={busyDriverId === driver._id}
                          className="rounded-lg border border-slate-200 p-3 text-slate-600 hover:bg-slate-50 disabled:opacity-40 lg:p-2"
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          type="button"
                          title="Reset password"
                          aria-label={`Reset password for ${driver.name}`}
                          onClick={() => openDialog("password", driver)}
                          disabled={busyDriverId === driver._id}
                          className="rounded-lg border border-slate-200 p-3 text-slate-600 hover:bg-slate-50 disabled:opacity-40 lg:p-2"
                        >
                          <KeyRound size={15} />
                        </button>
                        <button
                          type="button"
                          title={
                            driver.isActive
                              ? "Deactivate driver"
                              : "Activate driver"
                          }
                          aria-label={`${driver.isActive ? "Deactivate" : "Activate"} ${driver.name}`}
                          onClick={() => toggleDriverStatus(driver)}
                          disabled={busyDriverId === driver._id}
                          className="rounded-lg border border-slate-200 p-3 text-slate-600 hover:bg-slate-50 disabled:opacity-40 lg:p-2"
                        >
                          <Power size={15} />
                        </button>
                        <button
                          type="button"
                          title={
                            canDelete
                              ? "Delete driver"
                              : "Deactivate, unassign, and clear trip history before deletion"
                          }
                          aria-label={`Delete ${driver.name}`}
                          onClick={() => removeDriver(driver)}
                          disabled={!canDelete || busyDriverId === driver._id}
                          className="rounded-lg border border-red-200 p-3 text-red-700 hover:bg-red-50 disabled:opacity-40 lg:p-2"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!users.length && (
                <tr className="block lg:table-row">
                  <td
                    colSpan={7}
                    className="block p-8 text-center text-sm text-slate-500 lg:table-cell"
                  >
                    No drivers yet. Add a driver to get started.
                  </td>
                </tr>
              )}
            </tbody>
          </AdminTable>
        ) : (
          <AdminTable stackOnMobile>
            <thead className="hidden lg:table-header-group">
              <tr className="border-b bg-slate-50 text-xs uppercase text-slate-500">
                <th className="p-4">Name</th>
                <th>Email</th>
                <th>ID</th>
                <th>Role</th>
              </tr>
            </thead>
            <tbody className="block lg:table-row-group">
              {users.map((user) => (
                <tr
                  key={user._id}
                  className="grid grid-cols-2 gap-x-3 gap-y-3 border-b p-4 lg:table-row lg:p-0"
                >
                  <td className="col-span-2 font-bold lg:table-cell lg:p-4">{user.name}</td>
                  <td className="col-span-2 min-w-0 break-words text-sm lg:col-span-1 lg:table-cell">
                    <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-500 lg:hidden">Email</span>
                    {user.email}
                  </td>
                  <td className="text-sm lg:table-cell">
                    <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-500 lg:hidden">ID</span>
                    {user.studentId || "—"}
                  </td>
                  <td className="text-sm capitalize lg:table-cell">
                    <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-500 lg:hidden">Role</span>
                    {user.role}
                  </td>
                </tr>
              ))}
            </tbody>
          </AdminTable>
        )}
      </div>
      {dialogMode && role === "driver" && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/50 p-4">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="driver-dialog-title"
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl sm:p-6"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="driver-dialog-title" className="text-xl font-black">
                  {dialogMode === "create"
                    ? "Add Driver"
                    : dialogMode === "edit"
                      ? "Edit Driver"
                      : "Reset Driver Password"}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {dialogMode === "password"
                    ? `Set a new sign-in password for ${targetDriver?.name}.`
                    : "Manage the driver's account details."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDialogMode("")}
                aria-label="Close dialog"
                className="rounded-lg px-2 py-1 text-sm font-bold text-slate-500 hover:bg-slate-100"
              >
                Close
              </button>
            </div>
            <form onSubmit={saveDialog} className="mt-5 space-y-4">
              {(dialogMode === "create" || dialogMode === "edit") && (
                <>
                  <label className="block text-sm font-semibold">
                    Full name
                    <input
                      required
                      maxLength={80}
                      autoComplete="name"
                      autoFocus
                      value={form.name}
                      onChange={(event) =>
                        setForm({ ...form, name: event.target.value })
                      }
                      className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
                    />
                  </label>
                  <label className="block text-sm font-semibold">
                    Email
                    <input
                      required
                      type="email"
                      autoComplete="email"
                      value={form.email}
                      onChange={(event) =>
                        setForm({ ...form, email: event.target.value })
                      }
                      className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
                    />
                  </label>
                  <label className="block text-sm font-semibold">
                    Phone{" "}
                    <span className="font-normal text-slate-400">
                      (optional)
                    </span>
                    <input
                      type="tel"
                      autoComplete="tel"
                      value={form.phone}
                      onChange={(event) =>
                        setForm({ ...form, phone: event.target.value })
                      }
                      className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
                    />
                  </label>
                </>
              )}
              {(dialogMode === "create" || dialogMode === "password") && (
                <label className="block text-sm font-semibold">
                  {dialogMode === "create"
                    ? "Temporary password"
                    : "New password"}
                  <input
                    required
                    type="password"
                    minLength={8}
                    autoComplete="new-password"
                    autoFocus={dialogMode === "password"}
                    value={form.password}
                    onChange={(event) =>
                      setForm({ ...form, password: event.target.value })
                    }
                    className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
                  />
                  <span className="mt-1 block text-xs font-normal text-slate-500">
                    At least 8 characters.
                  </span>
                </label>
              )}
              {dialogMode === "password" && (
                <label className="block text-sm font-semibold">
                  Confirm new password
                  <input
                    required
                    type="password"
                    minLength={8}
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
                  />
                </label>
              )}
              {formError && (
                <p
                  role="alert"
                  className="rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-700"
                >
                  {formError}
                </p>
              )}
              <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => setDialogMode("")}
                  disabled={saving}
                  className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-50"
                >
                  {saving
                    ? "Saving…"
                    : dialogMode === "create"
                      ? "Create Driver"
                      : dialogMode === "edit"
                        ? "Save Details"
                        : "Reset Password"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </Layout>
  );
}
