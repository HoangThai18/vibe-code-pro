export function SaveButton({ pending, onClick }) {
  return (
    <button type="submit" className="btn btn-primary" disabled={pending} onClick={onClick}>
      {pending ? 'Đang lưu…' : 'Lưu'}
    </button>
  );
}
