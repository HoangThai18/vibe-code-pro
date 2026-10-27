<?php

namespace App\Tenancy;

use LogicException;

final class MissingTenantContext extends LogicException
{
    public function __construct()
    {
        parent::__construct('No tenant context: set TenantContext before touching tenant data.');
    }
}
