package spa.auth;

public enum Role {
    OWNER, MANAGER, STAFF;

    public static Role fromDb(String value) {
        return valueOf(value.toUpperCase(java.util.Locale.ROOT));
    }
}
